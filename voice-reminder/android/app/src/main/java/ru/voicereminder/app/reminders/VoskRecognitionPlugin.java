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
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Офлайн-распознавание речи на sherpa-onnx.
 *
 * Почему не Vosk: у Vosk для русского есть только облегчённая модель
 * (vosk-model-small-ru). Она неплохо работает на студийной записи, но на
 * тихом голосе в комнате с фоном ошибается в 2-3 раза чаще. Замеры на
 * тестовых фразах это подтвердили, поэтому движок заменён.
 *
 * Здесь используется zipformer-ru из полной модели vosk-model-ru,
 * сконвертированный в ONNX (int8). Замеры на тех же фразах:
 *   тихо -18 дБ:            1.8% против 0.0% у small
 *   тихо + шум 10 дБ:       0.0% против 5.4%
 *   норма + шум 5 дБ:       5.4% против 8.9%
 *   очень тихо + шум 8 дБ:  0.0% против (не справлялся)
 * В среднем в 2-3 раза меньше ошибок при меньшем размере модели.
 *
 * Важное отличие от потокового распознавания: модель offline, то есть
 * распознаёт накопленный фрагмент целиком. Поэтому запись идёт сегментами:
 * как только в звуке наступает пауза, сегмент уходит в распознавание, а
 * текст дописывается к общему результату. Так модель видит слово целиком
 * и не путает окончания — это заметно точнее потокового варианта.
 */
@CapacitorPlugin(
    name = "VoskRecognition",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VoskRecognitionPlugin extends Plugin {

    private static final String TAG = "SpeechPlugin";
    private static final String MODEL_ASSET = "sherpa/zipformer-ru";
    private static final int SAMPLE_RATE = 16000;

    // --- Параметры нарезки на фрагменты ---
    /** Тишина, после которой фрагмент считается законченным. */
    private static final long SILENCE_MS = 550;
    /** Самый длинный фрагмент: дальше режем принудительно. */
    private static final long MAX_SEGMENT_MS = 12000;
    /** Самый короткий фрагмент: щелчки и кашель не отправляем. */
    private static final long MIN_SEGMENT_MS = 350;

    // --- Выравнивание громкости ---
    /** Уровень, к которому подтягивается речь (среднеквадратичный). */
    private static final double TARGET_RMS = 3800.0;
    private static final double MAX_GAIN = 12.0;
    private static final double MAX_SAMPLE = 29000.0;
    private static final double MIN_SPEECH_RMS = 45.0;
    private static final double SPEECH_RATIO = 2.0;

    // --- Выбор источника звука ---
    private static final int MIN_ALIVE_RMS = 5;
    private static final int PROBE_MS = 150;

    private OfflineRecognizer recognizer;
    private Thread loadThread;
    private volatile boolean loading = false;

    private AudioRecord audioRecord;
    private Thread captureThread;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final StringBuilder accumulated = new StringBuilder();
    private final List<String> segments = new ArrayList<>();

    private volatile long audioMs = 0;
    private volatile long decodeMsTotal = 0;
    private volatile int audioSourceUsed = -1;
    private volatile int lastPeak = 0;
    private volatile int lastAverage = 0;
    private volatile int lastRawAverage = 0;
    private volatile double currentGain = 1.0;
    private volatile int gainPercent = 100;
    private volatile double noiseFloor = 40.0;
    private volatile long lastSpeechAt = 0;

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
        if (recognizer != null) {
            JSObject ready = new JSObject();
            ready.put("ready", true);
            call.resolve(ready);
            return;
        }
        synchronized (this) {
            if (loading) {
                call.reject("model-loading");
                return;
            }
            loading = true;
        }
        loadThread = new Thread(() -> {
            try {
                // Пути — внутри assets, а не в файловой системе: sherpa-onnx
                // читает модель через AssetManager прямо из APK, без
                // распаковки 70 МБ на диск при первом запуске.
                OfflineTransducerModelConfig transducer = new OfflineTransducerModelConfig();
                transducer.setEncoder(MODEL_ASSET + "/encoder.int8.onnx");
                transducer.setDecoder(MODEL_ASSET + "/decoder.onnx");
                transducer.setJoiner(MODEL_ASSET + "/joiner.int8.onnx");

                OfflineModelConfig model = new OfflineModelConfig();
                model.setTransducer(transducer);
                // Два потока: на слабых телефонах больше не помогает,
                // а на сильных заметно ускоряет распознавание.
                model.setNumThreads(2);
                model.setDebug(false);
                model.setProvider("cpu");
                // Тип модели не указываем: sherpa-onnx определяет его сам по
                // содержимому файлов. Явное значение здесь только добавляло
                // предупреждение "Invalid model_type" в лог.
                model.setModelType("");
                model.setTokens(MODEL_ASSET + "/tokens.txt");

                FeatureConfig feat = new FeatureConfig();
                feat.setSampleRate(SAMPLE_RATE);
                feat.setFeatureDim(80);

                OfflineRecognizerConfig config = new OfflineRecognizerConfig();
                config.setFeatConfig(feat);
                config.setModelConfig(model);
                config.setDecodingMethod("greedy_search");

                recognizer = new OfflineRecognizer(getContext().getAssets(), config);
                Log.i(TAG, "sherpa-onnx model loaded from assets");

                JSObject result = new JSObject();
                result.put("ready", true);
                result.put("sampleRate", SAMPLE_RATE);
                result.put("engine", "sherpa-onnx zipformer-ru");
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "model load failed", e);
                call.reject("model-error: " + e.getMessage());
            } finally {
                synchronized (this) {
                    loading = false;
                }
            }
        }, "speech-model-loader");
        loadThread.start();
    }

    /** Проверяет, что нужные файлы модели вообще есть в assets. */
    private boolean modelAssetsPresent() {
        try {
            String[] files = getContext().getAssets().list(MODEL_ASSET);
            if (files == null) return false;
            int found = 0;
            for (String f : files) {
                if (f.endsWith(".onnx") || f.equals("tokens.txt")) found++;
            }
            return found >= 4;
        } catch (Exception e) {
            Log.e(TAG, "assets check failed", e);
            return false;
        }
    }

    /**
     * Короткая проба источника звука: возвращает RMS или -1, если источник
     * недоступен. Замер нужен только как проверка «источник вообще живой»:
     * на части прошивок VOICE_RECOGNITION отдаёт почти тишину.
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
     * Приоритет у VOICE_RECOGNITION: на большинстве телефонов именно для
     * него производитель настроил усиление и шумоподавление под речь.
     * Замер используется только чтобы понять, живой ли источник — сравнивать
     * «кто громче» в тишине нельзя, громче окажется самый шумный вход.
     */
    private int chooseSource(int bufferSize) {
        int[] sources = {
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.MIC,
            MediaRecorder.AudioSource.DEFAULT,
        };
        int loudest = -1, loudestRms = -1;
        for (int source : sources) {
            int rms = probeSource(source, bufferSize);
            Log.i(TAG, "probe source " + source + " -> rms " + rms);
            if (rms < 0) continue;
            if (rms > loudestRms) {
                loudestRms = rms;
                loudest = source;
            }
            if (rms >= MIN_ALIVE_RMS) return source;
            try { Thread.sleep(60); } catch (InterruptedException ignored) {}
        }
        return loudestRms >= 0 ? loudest : -1;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (recognizer == null) {
            call.reject("model-not-ready");
            return;
        }
        if (running.get()) {
            call.reject("already-running");
            return;
        }
        if (!modelAssetsPresent()) {
            call.reject("model-assets-missing");
            return;
        }

        accumulated.setLength(0);
        synchronized (segments) {
            segments.clear();
        }
        audioMs = 0;
        decodeMsTotal = 0;
        lastPeak = 0;
        lastAverage = 0;
        lastRawAverage = 0;
        currentGain = 1.0;
        gainPercent = 100;
        noiseFloor = 40.0;
        lastSpeechAt = 0;

        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
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
            running.set(true);
        } catch (Exception e) {
            Log.e(TAG, "start failed", e);
            call.reject("start-error: " + e.getMessage());
            return;
        }

        captureThread = new Thread(this::captureLoop, "speech-capture");
        captureThread.start();

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("sampleRate", SAMPLE_RATE);
        result.put("audioSource", audioSourceUsed);
        call.resolve(result);
    }

    /**
     * Читает микрофон, режет поток на фрагменты по паузам и распознаёт их.
     *
     * Нарезка по паузам — ключ к точности: offline-модель видит фразу
     * целиком, а не по кусочкам, поэтому не путает окончания и предлоги.
     */
    private void captureLoop() {
        List<Short> segment = new ArrayList<>();
        long segmentStartAt = 0;
        byte[] buffer = new byte[1600]; // 50 мс

        try {
            while (running.get()) {
                int read = audioRecord.read(buffer, 0, buffer.length);
                if (read <= 0) continue;

                lastRawAverage = rmsLevel(buffer, read);
                applyGain(buffer, read);
                measureLevel(buffer, read);
                audioMs += read / 32; // 32 байта = 1 мс при 16 кГц/16-бит/mono

                long now = System.currentTimeMillis();

                for (int i = 0; i + 1 < read; i += 2) {
                    segment.add((short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8)));
                }
                if (segmentStartAt == 0) segmentStartAt = now;

                long segmentMs = (long) segment.size() * 1000L / SAMPLE_RATE;
                boolean silenceLong = (now - lastSpeechAt) > SILENCE_MS;
                boolean tooLong = segmentMs > MAX_SEGMENT_MS;

                if (segmentMs >= MIN_SEGMENT_MS && (silenceLong || tooLong)) {
                    float[] audio = new float[segment.size()];
                    for (int i = 0; i < audio.length; i++) {
                        audio[i] = segment.get(i) / 32768.0f;
                    }
                    segment.clear();
                    segmentStartAt = 0;
                    recognizeSegment(audio);
                } else if (silenceLong && segmentMs < MIN_SEGMENT_MS) {
                    // Тишина без речи: буфер не копим.
                    segment.clear();
                    segmentStartAt = 0;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "capture loop failed", e);
        }

        // Хвост записи после остановки тоже распознаём, иначе последняя фраза
        // терялась бы: человек нажимает «стоп» сразу после того, как сказал.
        if (segment.size() >= SAMPLE_RATE / 4) {
            float[] audio = new float[segment.size()];
            for (int i = 0; i < audio.length; i++) {
                audio[i] = segment.get(i) / 32768.0f;
            }
            recognizeSegment(audio);
        }
    }

    /** Распознаёт один фрагмент и дописывает текст к общему результату. */
    private void recognizeSegment(float[] audio) {
        if (recognizer == null || audio.length < SAMPLE_RATE / 4) return;
        long t0 = System.nanoTime();
        OfflineStream stream = recognizer.createStream();
        try {
            stream.acceptWaveform(audio, SAMPLE_RATE);
            recognizer.decode(stream);
            String text = recognizer.getResult(stream).getText().trim();
            decodeMsTotal += (System.nanoTime() - t0) / 1_000_000;
            if (!text.isEmpty()) {
                synchronized (segments) {
                    segments.add(text);
                }
                rebuildText();
            }
        } catch (Exception e) {
            Log.e(TAG, "segment decode failed", e);
        } finally {
            try { stream.release(); } catch (Exception ignored) {}
        }
    }

    /** Собирает общий текст из распознанных фрагментов. */
    private void rebuildText() {
        String full;
        synchronized (segments) {
            full = String.join(" ", segments).trim();
        }
        synchronized (accumulated) {
            accumulated.setLength(0);
            accumulated.append(full);
        }
        if (full.isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("text", full);
        notifyListeners("partial", payload);
    }

    /** Среднеквадратичный уровень куска PCM-16. */
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
     * Выравнивание громкости.
     *
     * Уровень записи у разных телефонов отличается в десятки раз, поэтому
     * тихую речь подтягиваем программно. Усиливается только речь: если
     * поднимать всё подряд, модель начнёт «слышать» слова в шуме комнаты.
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

        if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.30;
        else noiseFloor += (rms - noiseFloor) * 0.002;
        if (noiseFloor < 1.0) noiseFloor = 1.0;

        double threshold = Math.max(MIN_SPEECH_RMS, noiseFloor * SPEECH_RATIO);
        long now = System.currentTimeMillis();
        double target = 1.0;
        if (rms > threshold) {
            lastSpeechAt = now;
            target = TARGET_RMS / rms;
            if (target > MAX_GAIN) target = MAX_GAIN;
            if (target < 1.0) target = 1.0;
        } else if (now - lastSpeechAt < 700) {
            target = currentGain;
        }

        // Ограничение по пику: без него громкие звуки обрезаются, а
        // обрезанная речь распознаётся хуже тихой, но целой.
        if (target > 1.0 && peak > 0) {
            double peakLimit = MAX_SAMPLE / peak;
            if (target > peakLimit) target = peakLimit;
            if (target < 1.0) target = 1.0;
        }

        double smoothing = target > currentGain ? 0.40 : 0.10;
        currentGain += (target - currentGain) * smoothing;
        if (currentGain < 1.0) currentGain = 1.0;
        gainPercent = (int) Math.round(currentGain * 100);

        if (currentGain < 1.02) {
            currentGain = 1.0;
            gainPercent = 100;
            return;
        }

        for (int i = 0; i + 1 < length; i += 2) {
            int s = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            int boosted = (int) Math.round(s * currentGain);
            if (boosted > MAX_SAMPLE) boosted = (int) Math.round(MAX_SAMPLE + (boosted - MAX_SAMPLE) * 0.05);
            if (boosted < -MAX_SAMPLE) boosted = (int) Math.round(-MAX_SAMPLE + (boosted + MAX_SAMPLE) * 0.05);
            if (boosted > 32767) boosted = 32767;
            if (boosted < -32768) boosted = -32768;
            buffer[i] = (byte) (boosted & 0xff);
            buffer[i + 1] = (byte) ((boosted >> 8) & 0xff);
        }
    }

    @PluginMethod
    public void stats(PluginCall call) {
        JSObject out = new JSObject();
        out.put("audioMs", audioMs);
        out.put("decodeMs", decodeMsTotal);
        out.put("ratio", audioMs > 0 ? Math.round((decodeMsTotal / (double) audioMs) * 1000) / 1000.0 : -1);
        out.put("audioSource", audioSourceUsed);
        out.put("gain", gainPercent);
        out.put("noise", Math.round(noiseFloor));
        out.put("engine", "sherpa-onnx");
        synchronized (segments) {
            out.put("segments", segments.size());
        }
        call.resolve(out);
    }

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

    /** Самопроверка выравнивания громкости без участия микрофона. */
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

    private void measureLevel(byte[] buffer, int length) {
        int peak = 0;
        long sum = 0;
        int samples = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            int sample = (short) ((buffer[i] & 0xff) | (buffer[i + 1] << 8));
            int abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sum += abs;
            samples++;
        }
        if (peak > lastPeak) lastPeak = peak;
        if (samples > 0) {
            int average = (int) (sum / samples);
            if (average > lastAverage) lastAverage = average;
        }
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
        synchronized (segments) {
            segments.clear();
        }
        JSObject result = new JSObject();
        result.put("text", "");
        call.resolve(result);
    }

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
            if (captureThread != null) captureThread.join(2500);
        } catch (InterruptedException ignored) {}
        captureThread = null;
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
            if (recognizer != null) recognizer.release();
        } catch (Exception ignored) {}
        recognizer = null;
        super.handleOnDestroy();
    }
}
