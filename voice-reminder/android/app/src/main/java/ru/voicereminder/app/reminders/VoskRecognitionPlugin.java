package ru.voicereminder.app.reminders;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
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
 * Прототип офлайн-распознавания на Vosk.
 *
 * Отличия от системного SpeechRecognizer:
 *  - не имеет таймаута тишины: слушает столько, сколько нужно;
 *  - полностью офлайн, модель лежит в assets;
 *  - результат накапливается по сегментам без потери текста.
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
    private PluginCall pendingCall;
    private final StringBuilder accumulated = new StringBuilder();
    private final Handler handler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void prepare(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micResult");
            return;
        }
        loadModel(call);
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("not-allowed");
            return;
        }
        loadModel(call);
    }

    private void loadModel(PluginCall call) {
        if (model != null) {
            call.resolve(new JSObject().put("ready", true));
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

    /** Копирует папку модели из assets во внутреннее хранилище (один раз). */
    private void copyAssets(String assetPath, File target) throws Exception {
        String[] children = getContext().getAssets().list(assetPath);
        if (children == null || children.length == 0) {
            target.getParentFile().mkdirs();
            try (InputStream in = getContext().getAssets().open(assetPath);
                 FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[8192];
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
        pendingCall = call;
        accumulated.setLength(0);

        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(minBuffer, SAMPLE_RATE); // ~1 секунда запас

        try {
            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, bufferSize);
            recognizer = new org.vosk.Recognizer(model, SAMPLE_RATE);
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                call.reject("mic-init-failed");
                return;
            }
            audioRecord.startRecording();
            running.set(true);
        } catch (Exception e) {
            Log.e(TAG, "start failed", e);
            call.reject("start-error: " + e.getMessage());
            return;
        }

        captureThread = new Thread(() -> {
            byte[] buffer = new byte[3200]; // 100 мс при 16 кГц mono 16-бит
            try {
                while (running.get()) {
                    int read = audioRecord.read(buffer, 0, buffer.length);
                    if (read <= 0) continue;
                    if (recognizer.acceptWaveForm(buffer, read)) {
                        String text = extractText(recognizer.getResult(), "text");
                        appendSegment(text);
                    } else {
                        String partial = extractText(recognizer.getPartialResult(), "partial");
                        if (!partial.isEmpty()) emitPartial(partial);
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

    private String extractText(String json, String key) {
        try {
            JSONObject obj = new JSONObject(json);
            return obj.optString(key, "").trim();
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
        emitPartial(text, true);
    }

    private void emitPartial(String text) {
        emitPartial(text, false);
    }

    private void emitPartial(String text, boolean segmentFinished) {
        String full;
        synchronized (accumulated) {
            full = accumulated.toString();
        }
        JSObject payload = new JSObject();
        payload.put("text", full.isEmpty() ? text : (full + " " + text).trim());
        payload.put("final", segmentFinished);
        notifyListeners("partial", payload);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String finalText = shutdown();
        JSObject result = new JSObject();
        result.put("text", finalText);
        call.resolve(result);
    }

    @PluginMethod
    public void abort(PluginCall call) {
        shutdown();
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
        String tail = "";
        try {
            if (recognizer != null) {
                tail = extractText(recognizer.getFinalResult(), "text");
                recognizer.close();
            }
        } catch (Exception ignored) {}
        recognizer = null;
        if (!tail.isEmpty()) appendSegment(tail);
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
