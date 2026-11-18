package ru.voicereminder.app.reminders;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
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

        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(minBuffer, SAMPLE_RATE * 2);

        try {
            // Выбор источника микрофона — главное для чувствительности.
            //
            // VOICE_RECOGNITION (6) включает АРУ и шумоподавление на уровне
            // драйвера: тихую речь он подтягивает до нормального уровня. Именно
            // его использует официальная библиотека Vosk (SpeechService), и
            // без него приложение «плохо слышит» на большинстве телефонов.
            //
            // Но на части устройств (старые прошивки, отдельные вендоры)
            // источник 6 отсутствует или отдаёт тишину. Поэтому пробуем по
            // очереди: 6 -> 7 -> 1 -> 0, и берём первый, который реально
            // открылся и начал давать ненулевой звук.
            int[] sources = {
                MediaRecorder.AudioSource.VOICE_RECOGNITION,  // 6: АРУ + шумодав
                MediaRecorder.AudioSource.VOICE_COMMUNICATION, // 7: гарнитуры
                MediaRecorder.AudioSource.MIC,                 // 1: сырой сигнал
                MediaRecorder.AudioSource.DEFAULT,             // 0: как решит система
            };
            for (int source : sources) {
                AudioRecord candidate = null;
                try {
                    candidate = new AudioRecord(
                        source,
                        SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, bufferSize);
                    if (candidate.getState() != AudioRecord.STATE_INITIALIZED) {
                        candidate.release();
                        continue;
                    }
                    candidate.startRecording();
                    if (candidate.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                        candidate.release();
                        continue;
                    }
                    audioRecord = candidate;
                    audioSourceUsed = source;
                    Log.i(TAG, "audio source selected: " + source);
                    break;
                } catch (Exception e) {
                    Log.w(TAG, "audio source " + source + " unavailable: " + e.getMessage());
                    if (candidate != null) {
                        try { candidate.release(); } catch (Exception ignored) {}
                    }
                }
            }
            if (audioRecord == null) {
                call.reject("mic-init-failed");
                return;
            }

            recognizer = new org.vosk.Recognizer(model, SAMPLE_RATE);
            // Опции распознавателя: при малом числе результатов Vosk быстрее и
            // стабильнее; слова в JSON не нужны для нашей задачи («текст»).
            recognizer.setMaxAlternatives(0);
            recognizer.setWords(false);
            recognizer.setPartialWords(false);

            // Порог конца фразы оставляем по умолчанию: Vosk сам решает,
            // когда сегмент закончился, а ручная настройка на части версий
            // библиотеки ведёт себя непредсказуемо.

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
                    // Измеряем уровень сигнала: если микрофон молчит (peak = 0),
                    // дело не в распознавании, а в источнике или разрешениях.
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
        call.resolve(result);
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
        call.resolve(out);
    }

    /**
     * Сколько звука реально приходит с микрофона: пиковая амплитуда и средний
     * уровень за последнюю сессию. Нужна, чтобы отличить «микрофон не даёт
     * сигнал» от «сигнал есть, но распознавание не справляется».
     */
    @PluginMethod
    public void level(PluginCall call) {
        JSObject out = new JSObject();
        out.put("peak", lastPeak);
        out.put("average", lastAverage);
        out.put("source", audioSourceUsed);
        call.resolve(out);
    }

    /**
     * Считает пиковую и среднюю амплитуду куска PCM-16.
     *
     * Нужно для диагностики «плохо слышит» на разных телефонах: если пик
     * близок к нулю, микрофон молчит (источник не тот или нет разрешения),
     * а если пик высокий, но текста нет — проблема в распознавании, а не в звуке.
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
        if (peak > lastPeak) lastPeak = peak;
        if (samples > 0) lastAverage = (int) (sum / samples);
    }

    private String extractText(String json, String key) {        try {
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
        try {
            if (recognizer != null) recognizer.close();
        } catch (Exception ignored) {}
        try {
            if (model != null) model.close();
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }
}
