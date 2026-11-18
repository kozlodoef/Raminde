package ru.voicereminder.app.reminders;

import android.Manifest;
import android.content.SharedPreferences;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Офлайн-распознавание речи на Vosk.
 *
 * В отличие от системного SpeechRecognizer не имеет таймаута тишины:
 * запись идёт до явной остановки, а результат накапливается по сегментам.
 *
 * Чувствительность микрофона — главная боль этого класса. Телефоны отдают
 * очень разный уровень записи: одна и та же речь на одном устройстве даёт
 * амплитуду в тысячи, на другом — десятки. Поэтому источник звука
 * выбирается замером, а громкость выравнивается программно.
 */
@CapacitorPlugin(
    name = "VoskRecognition",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VoskRecognitionPlugin extends Plugin {

    private static final String TAG = "VoskPlugin";
    private static final String MODEL_ASSET = "vosk/vosk-model-small-ru-0.22";
    private static final int SAMPLE_RATE = 16000;

    // --- Выравнивание громкости (АРУ) ---
    /** Уровень, к которому подтягивается речь (среднеквадратичный, до 32767). */
    private static final double TARGET_RMS = 3800.0;
    /** Предел усиления: выше начинаем вытягивать собственный шум микрофона. */
    private static final double MAX_GAIN = 12.0;
    /**
     * Потолок амплитуды после усиления.
     *
     * Ограничитель обязателен: без него громкий звук после тишины усиливается
     * тем же коэффициентом и упирается в предел 32767. Клиппинг (обрезанные
     * вершины) распознаётся заметно хуже, чем тихая, но целая запись.
     */
    private static final double MAX_SAMPLE = 29000.0;
    /**
     * Абсолютный минимум, ниже которого сигнал считается тишиной.
     *
     * Важно не завысить: тихая речь с расстояния даёт RMS всего 40-100.
     * Если поставить порог 110, усиление не включится как раз в том случае,
     * на который жалуются пользователи («говорю тихо — не слышит»).
     * Защиту от шума обеспечивает адаптивный порог ниже.
     */
    private static final double MIN_SPEECH_RMS = 45.0;
    /** Во сколько раз сигнал должен превышать шум, чтобы считаться речью. */
    private static final double SPEECH_RATIO = 2.0;
    /**
     * Сколько миллисекунд держать усиление после последнего слова.
     *
     * Между словами и слогами есть короткие паузы. Если сбрасывать усиление
     * на каждой из них, громкость «дышит»: Vosk получает то громкий, то
     * тихий звук и разбирает его хуже. Поэтому усиление живёт ещё немного
     * после того, как речь стихла.
     */
    private static final long HOLD_MS = 700;

    // --- Выбор источника звука ---
    /** Минимальный уровень, при котором источник считается «живым». */
    private static final int MIN_ALIVE_RMS = 5;
    /** Длительность пробы одного источника звука. */
    private static final int PROBE_MS = 150;

    private org.vosk.Model model;
    private org.vosk.Recognizer recognizer;
    private AudioRecord audioRecord;
    private Thread captureThread;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final StringBuilder accumulated = new StringBuilder();
    private volatile long audioMs = 0;
    private volatile long decodeMsTotal = 0;
    /** Какой источник микрофона удалось открыть (для диагностики на разных телефонах). */
    private volatile int audioSourceUsed = -1;
    /** Пиковая амплитуда и средний уровень сигнала за последнюю сессию. */
    private volatile int lastPeak = 0;
    private volatile int lastAverage = 0;
    /** Уровень до усиления: показывает, насколько тихим был микрофон. */
    private volatile int lastRawAverage = 0;
    /** Текущее усиление АРУ (1.0 = без усиления). */
    private volatile double currentGain = 1.0;
    private volatile int gainPercent = 100;
    /** Оценка уровня шума в помещении: нужна, чтобы не усиливать тишину. */
    private volatile double noiseFloor = 40.0;
    /** Когда последний раз слышали речь: усиление держится ещё HOLD_MS. */
    private volatile long lastSpeechAt = 0;
    /**
     * Системные аудиоэффекты.
     *
     * Автоматическая регулировка усиления (АРУ) на уровне драйвера —
     * самый надёжный способ поднять тихую речь: она работает до нашей
     * обработки, знает про конкретный микрофон телефона и не даёт
     * клиппинга. Доступна с Android 4.1 (API 16), а minSdk проекта 24,
     * поэтому проверка версии не нужна.
     *
     * Эффект может быть не поддержан прошивкой — тогда поля остаются null
     * и работает наша программная обработка.
     */
    private AutomaticGainControl systemAgc;
    private NoiseSuppressor systemNs;

    @PluginMethod
    public void prepare(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micResult");
            return;
        }
        loadModel(call);
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("not-allowed");
            return;
        }
        loadModel(call);
    }

    private void loadModel(PluginCall call) {
        if (model != null) {
            JSObject ready = new JSObject();
            ready.put("ready", true);
            call.resolve(ready);
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "vosk-model");
                if (!dir.exists() || dir.listFiles() == null || dir.listFiles().length == 0) {
                    copyAssets(MODEL_ASSET, dir);
                }
                model = new org.vosk.Model(dir.getAbsolutePath());
                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("sampleRate", SAMPLE_RATE);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "model load failed", e);
                call.reject("model-error: " + e.getMessage());
            }
        }, "vosk-model-loader").start();
    }

    /** Копирует папку модели из assets во внутреннее хранилище. */
    private void copyAssets(String assetPath, File target) throws Exception {
        String[] children = getContext().getAssets().list(assetPath);
        if (children == null || children.length == 0) {
            File parent = target.getParentFile();
            if (parent != null) parent.mkdirs();
            try (InputStream in = getContext().getAssets().open(assetPath);
                 FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[16384];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            }
            return;
        }
        target.mkdirs();
        for (String child : children) {
            copyAssets(assetPath + "/" + child, new File(target, child));
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("vosk-recognition", 0);
    }

    /**
     * Короткая проба источника звука.
     *
     * Возвращает среднеквадратичный уровень или -1, если источник недоступен.
     * Замер нужен потому, что «источник открылся» и «источник слышит» — на
     * разных телефонах не одно и то же: часть прошивок отдаёт с отдельных
     * источников почти тишину.
     */
    private int probeSource(int source, int bufferSize) {
        AudioRecord probe = null;
        try {
            probe = new AudioRecord(source, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize);
            if (probe.getState() != AudioRecord.STATE_INITIALIZED) return -1;
            probe.startRecording();
            if (probe.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) return -1;
            byte[] buf = new byte[3200];
            long sumSquares = 0;
            int samples = 0;
            long deadline = System.currentTimeMillis() + PROBE_MS;
            while (System.currentTimeMillis() < deadline) {
                int read = probe.read(buf, 0, buf.length);
                if (read <= 0) break;
                for (int i = 0; i + 1 < read; i += 2) {
                    int s = (short) ((buf[i] & 0xff) | (buf[i + 1] << 8));
                    sumSquares += (long) s * s;
                    samples++;
                }
            }
            if (samples <= 0) return 0;
            return (int) Math.sqrt(sumSquares / (double) samples);
        } catch (Exception e) {
            Log.w(TAG, "probe " + source + " failed: " + e.getMessage());
            return -1;
        } finally {
            if (probe != null) {
                try { probe.stop(); } catch (Exception ignored) {}
                try { probe.release(); } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Выбирает источник микрофона.
     *
     * Приоритет отдаётся VOICE_RECOGNITION: именно его использует официальная
     * библиотека Vosk, и он единственный, где производитель телефона уже
     * настроил усиление и шумоподавление под речь.
     *
     * Замер в тишине НЕ сравнивает «кто громче»: в тишине громче всего тот
     * источник, у которого больше собственный шум, — выбирать его означало бы
     * специально брать самый шумный вход. Поэтому замер используется только
     * как проверка «живой ли источник вообще»: если приоритетный путь отдаёт
     * почти нулевой сигнал (бывает на отдельных прошивках), берём следующий.
     */
    private int chooseSource(int bufferSize) {
        int[] sources = {
            MediaRecorder.AudioSource.VOICE_RECOGNITION,   // 6: АРУ + шумодав
            MediaRecorder.AudioSource.VOICE_COMMUNICATION, // 7: гарнитуры
            MediaRecorder.AudioSource.MIC,                 // 1: сырой сигнал
            MediaRecorder.AudioSource.DEFAULT,             // 0: как решит система
        };

        int firstAlive = -1;
        int loudest = -1, loudestRms = -1;

        for (int source : sources) {
            int rms = probeSource(source, bufferSize);
            Log.i(TAG, "probe source " + source + " -> rms " + rms);
            if (rms < 0) continue;
            if (rms > loudestRms) {
                loudestRms = rms;
                loudest = source;
            }
            if (rms >= MIN_ALIVE_RMS) {
                firstAlive = source;
                break; // приоритетный источник живой — дальше не ищем
            }
            try { Thread.sleep(60); } catch (InterruptedException ignored) {}
        }

        int chosen = firstAlive >= 0 ? firstAlive : (loudestRms >= 0 ? loudest : -1);
        Log.i(TAG, "audio source chosen: " + chosen);
        return chosen;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (model == null) {
            call.reject("model-not-ready");
            return;
        }
        if (running.get()) {
            call.reject("already-running");
            return;
        }
        accumulated.setLength(0);
        audioMs = 0;
        decodeMsTotal = 0;
        lastPeak = 0;
        lastAverage = 0;
        lastRawAverage = 0;
        currentGain = 1.0;
        gainPercent = 100;
        noiseFloor = 40.0;

        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        // Полсекунды запаса: на части телефонов маленький буфер даёт обрывы.
        int bufferSize = Math.max(minBuffer, SAMPLE_RATE);

        try {
            int source = chooseSource(bufferSize);
            if (source < 0) {
                call.reject("mic-init-failed");
                return;
            }
            AudioRecord candidate = new AudioRecord(
                source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, bufferSize);
            if (candidate.getState() != AudioRecord.STATE_INITIALIZED) {
                candidate.release();
                call.reject("mic-init-failed");
                return;
            }
            candidate.startRecording();
            if (candidate.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                candidate.release();
                call.reject("mic-init-failed");
                return;
            }
            audioRecord = candidate;
            audioSourceUsed = source;
            Log.i(TAG, "audio source selected: " + source);
            attachAudioEffects(candidate);

            recognizer = new org.vosk.Recognizer(model, SAMPLE_RATE);
            // Опции распознавателя: при малом числе результатов Vosk быстрее и
            // стабильнее; слова в JSON не нужны для нашей задачи («текст»).
            recognizer.setMaxAlternatives(0);
            recognizer.setWords(false);
            recognizer.setPartialWords(false);

            running.set(true);
        } catch (Exception e) {
            Log.e(TAG, "start failed", e);
            call.reject("start-error: " + e.getMessage());
            return;
        }

        captureThread = new Thread(() -> {
            // 50 мс аудио за чтение: текст появляется вдвое быстрее.
            byte[] buffer = new byte[1600];
            long lastPartialAt = 0;
            try {
                while (running.get()) {
                    int read = audioRecord.read(buffer, 0, buffer.length);
                    if (read <= 0) continue;
                    // Сначала запоминаем исходный уровень, потом усиливаем:
                    // так в диагностике видно, насколько тихим был микрофон.
                    lastRawAverage = rmsLevel(buffer, read);
                    applyGain(buffer, read);
                    measureLevel(buffer, read);
                    long t0 = System.nanoTime();
                    boolean segmentDone = recognizer.acceptWaveForm(buffer, read);
                    long decodeMs = (System.nanoTime() - t0) / 1_000_000;
                    audioMs += read / 32; // 32 байта = 1 мс при 16 кГц/16-бит/mono
                    decodeMsTotal += decodeMs;
                    if (segmentDone) {
                        appendSegment(extractText(recognizer.getResult(), "text"));
                        lastPartialAt = 0;
                    } else if (System.nanoTime() - lastPartialAt > 120_000_000L) {
                        // getPartialResult() дорогая: обновляем не чаще 8 раз в секунду.
                        lastPartialAt = System.nanoTime();
                        String partial = extractText(recognizer.getPartialResult(), "partial");
                        if (!partial.isEmpty()) emitText(partial);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "capture loop failed", e);
            }
        }, "vosk-capture");
        captureThread.start();

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("sampleRate", SAMPLE_RATE);
        result.put("audioSource", audioSourceUsed);
        call.resolve(result);
    }

    /**
     * Подключает системные аудиоэффекты к открытому микрофону.
     *
     * Автоматическая регулировка усиления на уровне драйвера поднимает тихую
     * речь ещё до того, как звук дойдёт до нас: она знает характеристики
     * конкретного микрофона и не создаёт клиппинга, в отличие от простого
     * умножения амплитуды. Шумоподавление убирает фон, из-за которого Vosk
     * «слышит» слова в тишине.
     *
     * Оба эффекта появились в Android 4.1 (API 16), а minSdk проекта 24,
     * поэтому проверки версии не нужны. Прошивка может их не поддерживать —
     * тогда просто остаётся наша программная обработка.
     */
    private void attachAudioEffects(AudioRecord record) {
        // Шумоподавление включаем ТОЛЬКО для «сырых» источников.
        //
        // VOICE_RECOGNITION и VOICE_COMMUNICATION уже проходят шумоподавление
        // и АРУ внутри драйвера телефона. Если наложить сверху ещё один
        // шумодав, подавление становится двойным и тихая речь пропадает
        // совсем — именно это и выглядит как «нужно кричать в микрофон».
        boolean rawSource = audioSourceUsed == MediaRecorder.AudioSource.MIC
            || audioSourceUsed == MediaRecorder.AudioSource.DEFAULT;

        try {
            if (AutomaticGainControl.isAvailable()) {
                systemAgc = AutomaticGainControl.create(record.getAudioSessionId());
                if (systemAgc != null) {
                    systemAgc.setEnabled(true);
                    Log.i(TAG, "system AGC enabled");
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "system AGC unavailable: " + e.getMessage());
            systemAgc = null;
        }

        if (!rawSource) {
            Log.i(TAG, "system noise suppressor skipped: source already processed");
            return;
        }
        try {
            if (NoiseSuppressor.isAvailable()) {
                systemNs = NoiseSuppressor.create(record.getAudioSessionId());
                if (systemNs != null) {
                    systemNs.setEnabled(true);
                    Log.i(TAG, "system noise suppressor enabled");
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "system noise suppressor unavailable: " + e.getMessage());
            systemNs = null;
        }
    }

    /** Отключает и освобождает системные аудиоэффекты. */
    private void releaseAudioEffects() {
        if (systemAgc != null) {
            try {
                systemAgc.setEnabled(false);
                systemAgc.release();
            } catch (Exception ignored) {}
            systemAgc = null;
        }
        if (systemNs != null) {
            try {
                systemNs.setEnabled(false);
                systemNs.release();
            } catch (Exception ignored) {}
            systemNs = null;
        }
    }

    /** Среднеквадратичный уровень куска PCM-16 (0..32767). */
    private int rmsLevel(byte[] buffer, int length) {
        long sumSquares = 0;
        int samples = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            int s = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            sumSquares += (long) s * s;
            samples++;
        }
        return samples > 0 ? (int) Math.sqrt(sumSquares / (double) samples) : 0;
    }

    /**
     * Программное выравнивание громкости (АРУ).
     *
     * Главное средство против «нужно говорить громко и вплотную». Драйверы
     * отдают очень разный уровень: на одном телефоне обычная речь даёт около
     * 20000, на другом та же речь — 200. Штатная АРУ помогает не везде, а
     * вместе с шумоподавлением иногда «съедает» тихую речь целиком. Поэтому
     * уровень подтягиваем сами, чистой арифметикой над PCM: такой код
     * одинаково работает на любой версии Android начиная с 7.0.
     *
     * Ключевой момент — усиливается только речь. Уровень шума оценивается
     * на ходу: если усиливать всё подряд, Vosk начнёт «слышать» слова в
     * шуме комнаты и выдавать бессмысленный текст. Поэтому усиление
     * включается лишь когда сигнал заметно громче шума, а в тишине
     * остаётся ровно 1.0 (без изменений).
     */
    private void applyGain(byte[] buffer, int length) {
        int samples = length / 2;
        if (samples <= 0) return;

        long sumSquares = 0;
        int peak = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            int s = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            sumSquares += (long) s * s;
            int abs = Math.abs(s);
            if (abs > peak) peak = abs;
        }
        double rms = Math.sqrt(sumSquares / (double) samples);

        // Оценка шума: вниз идём быстро (шум стих — сразу это учли),
        // вверх очень медленно, чтобы речь не была принята за шум.
        if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.30;
        else noiseFloor += (rms - noiseFloor) * 0.002;
        if (noiseFloor < 1.0) noiseFloor = 1.0;

        double threshold = Math.max(MIN_SPEECH_RMS, noiseFloor * SPEECH_RATIO);
        long now = System.currentTimeMillis();
        double target = 1.0;
        if (rms > threshold) {
            // Это речь: запоминаем момент и считаем нужное усиление.
            lastSpeechAt = now;
            target = TARGET_RMS / rms;
            if (target > MAX_GAIN) target = MAX_GAIN;
            if (target < 1.0) target = 1.0; // громкую речь не приглушаем
        } else if (now - lastSpeechAt < HOLD_MS) {
            // Короткая пауза внутри фразы: усиление сохраняем прежним,
            // иначе громкость «дышит» и Vosk хуже разбирает слова.
            target = currentGain;
        }

        // Ограничение по пику: речь с резкими звуками («п», «т», «с») имеет
        // пик в 5-8 раз выше среднего уровня. Если считать усиление только по
        // среднему, пики упираются в предел шкалы и обрезаются — а обрезанный
        // звук Vosk разбирает хуже, чем тихий, но целый. Поэтому потолок
        // усиления дополнительно упирается в MAX_SAMPLE по пику этого куска.
        if (target > 1.0 && peak > 0) {
            double peakLimit = MAX_SAMPLE / peak;
            if (target > peakLimit) target = peakLimit;
            if (target < 1.0) target = 1.0;
        }

        // Быстро подхватываем тихую речь, медленно отпускаем — так не «дышит».
        double smoothing = target > currentGain ? 0.40 : 0.10;
        currentGain += (target - currentGain) * smoothing;
        if (currentGain < 1.0) currentGain = 1.0;
        gainPercent = (int) Math.round(currentGain * 100);

        if (currentGain < 1.02) {
            // Усиления нет — сигнал не трогаем вовсе.
            currentGain = 1.0;
            gainPercent = 100;
            return;
        }

        for (int i = 0; i + 1 < length; i += 2) {
            int s = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            int boosted = (int) Math.round(s * currentGain);
            // Мягкое ограничение вместо жёсткого обрезания: выше MAX_SAMPLE
            // сигнал плавно «скругляется», а не превращается в прямоугольник.
            if (boosted > MAX_SAMPLE) boosted = (int) Math.round(MAX_SAMPLE + (boosted - MAX_SAMPLE) * 0.05);
            if (boosted < -MAX_SAMPLE) boosted = (int) Math.round(-MAX_SAMPLE + (boosted + MAX_SAMPLE) * 0.05);
            if (boosted > 32767) boosted = 32767;
            if (boosted < -32768) boosted = -32768;
            buffer[i] = (byte) (boosted & 0xff);
            buffer[i + 1] = (byte) ((boosted >> 8) & 0xff);
        }
    }

    /** Отношение времени обработки к длительности аудио: <1 быстрее реального времени. */
    @PluginMethod
    public void stats(PluginCall call) {
        JSObject out = new JSObject();
        out.put("audioMs", audioMs);
        out.put("decodeMs", decodeMsTotal);
        out.put("ratio", audioMs > 0 ? Math.round((decodeMsTotal / (double) audioMs) * 1000) / 1000.0 : -1);
        // Источник микрофона полезно знать при разборе жалоб «плохо слышит»
        // на конкретной модели телефона.
        out.put("audioSource", audioSourceUsed);
        out.put("gain", gainPercent);
        out.put("noise", Math.round(noiseFloor));
        call.resolve(out);
    }

    /**
     * Сколько звука реально приходит с микрофона: пиковая амплитуда и средний
     * уровень. Нужна, чтобы отличить «микрофон не даёт сигнал» от «сигнал
     * есть, но распознавание не справляется».
     *
     * raw — уровень до усиления, average — уже после: по разнице видно,
     * насколько тихим был микрофон и сколько добавила АРУ.
     */
    @PluginMethod
    public void level(PluginCall call) {
        JSObject out = new JSObject();
        out.put("peak", lastPeak);
        out.put("average", lastAverage);
        out.put("raw", lastRawAverage);
        out.put("gain", gainPercent);
        out.put("noise", Math.round(noiseFloor));
        out.put("source", audioSourceUsed);
        call.resolve(out);
    }

    /**
     * Самопроверка выравнивания громкости.
     *
     * Прогоняет синтетические сигналы через тот же код, что обрабатывает
     * живую запись, и возвращает уровень до и после. Нужна, чтобы проверить
     * усиление без микрофона: качество записи у телефонов разное, а
     * арифметика усиления должна работать одинаково на всех.
     */
    @PluginMethod
    public void selfTest(PluginCall call) {
        double savedGain = currentGain;
        double savedNoise = noiseFloor;
        long savedSpeech = lastSpeechAt;
        try {
            JSObject out = new JSObject();
            out.put("quietSpeech", runGainProbe(300));
            out.put("veryQuiet", runGainProbe(90));
            out.put("normalSpeech", runGainProbe(6000));
            out.put("silence", runGainProbe(3));
            call.resolve(out);
        } finally {
            currentGain = savedGain;
            noiseFloor = savedNoise;
            lastSpeechAt = savedSpeech;
        }
    }

    /**
     * Прогоняет 50 буферов с синусоидой заданной амплитуды и возвращает
     * уровень до и после усиления. 50 буферов — это 2,5 секунды звука:
     * столько нужно, чтобы сглаживание усиления успело установиться.
     */
    private JSObject runGainProbe(int amplitude) {
        currentGain = 1.0;
        noiseFloor = 20.0;
        lastSpeechAt = 0;
        int before = 0;
        int after = 0;
        for (int b = 0; b < 50; b++) {
            byte[] buf = tone(amplitude);
            before = rmsLevel(buf, buf.length);
            applyGain(buf, buf.length);
            after = rmsLevel(buf, buf.length);
        }
        JSObject o = new JSObject();
        o.put("before", before);
        o.put("after", after);
        o.put("gain", gainPercent);
        return o;
    }

    /** Синтетический сигнал: синусоида 440 Гц длиной 50 мс. */
    private byte[] tone(int amplitude) {
        byte[] buf = new byte[1600];
        for (int i = 0; i + 1 < buf.length; i += 2) {
            int n = i / 2;
            int s = (int) Math.round(amplitude * Math.sin(2 * Math.PI * 440 * n / SAMPLE_RATE));
            buf[i] = (byte) (s & 0xff);
            buf[i + 1] = (byte) ((s >> 8) & 0xff);
        }
        return buf;
    }

    /**
     * Считает пиковую и среднюю амплитуду куска PCM-16.
     *
     * Нужно для диагностики «плохо слышит» на разных телефонах: если пик
     * близок к нулю, микрофон молчит (источник не тот или нет разрешения),
     * а если пик высокий, но текста нет — проблема в распознавании.
     */
    private void measureLevel(byte[] buffer, int length) {
        int peak = 0;
        long sum = 0;
        int samples = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            // Маленький порядок байт: PCM 16-бит little-endian.
            int sample = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            int abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sum += abs;
            samples++;
        }
        // Держим максимум за сессию, а не последний кусок: иначе диагностика
        // после короткой паузы показывает нули и вводит в заблуждение.
        if (peak > lastPeak) lastPeak = peak;
        if (samples > 0) {
            int average = (int) (sum / samples);
            if (average > lastAverage) lastAverage = average;
        }
    }

    private String extractText(String json, String key) {
        try {
            return new JSONObject(json).optString(key, "").trim();
        } catch (Exception e) {
            return "";
        }
    }

    private void appendSegment(String text) {
        if (text.isEmpty()) return;
        synchronized (accumulated) {
            if (accumulated.length() > 0) accumulated.append(' ');
            accumulated.append(text);
        }
        emitText("");
    }

    /** Отправляет в JS полный накопленный текст плюс текущий сегмент. */
    private void emitText(String partial) {
        String full;
        synchronized (accumulated) {
            full = accumulated.toString();
        }
        String text = partial.isEmpty() ? full : (full.isEmpty() ? partial : full + " " + partial).trim();
        if (text.isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("text", text);
        notifyListeners("partial", payload);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JSObject result = new JSObject();
        result.put("text", shutdown());
        call.resolve(result);
    }

    @PluginMethod
    public void abort(PluginCall call) {
        shutdown();
        synchronized (accumulated) {
            accumulated.setLength(0);
        }
        JSObject result = new JSObject();
        result.put("text", "");
        call.resolve(result);
    }

    /** Останавливает запись и возвращает накопленный текст. */
    private String shutdown() {
        running.set(false);
        try {
            if (audioRecord != null) {
                audioRecord.stop();
                audioRecord.release();
            }
        } catch (Exception ignored) {}
        audioRecord = null;
        // Эффекты снимаем до закрытия сессии: иначе они остаются висеть
        // и следующий запуск может получить «занятый» микрофон.
        releaseAudioEffects();
        try {
            if (captureThread != null) captureThread.join(800);
        } catch (InterruptedException ignored) {}
        captureThread = null;
        try {
            if (recognizer != null) {
                appendSegment(extractText(recognizer.getFinalResult(), "text"));
                recognizer.close();
            }
        } catch (Exception ignored) {}
        recognizer = null;
        synchronized (accumulated) {
            return accumulated.toString().trim();
        }
    }

    @Override
    protected void handleOnDestroy() {
        running.set(false);
        try {
            if (audioRecord != null) audioRecord.release();
        } catch (Exception ignored) {}
        audioRecord = null;
        releaseAudioEffects();
        try {
            if (recognizer != null) recognizer.close();
        } catch (Exception ignored) {}
        try {
            if (model != null) model.close();
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }
}
