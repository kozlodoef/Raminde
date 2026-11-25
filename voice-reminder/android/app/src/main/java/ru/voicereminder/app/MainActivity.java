package ru.voicereminder.app;

import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import ru.voicereminder.app.reminders.ReminderPlugin;
import ru.voicereminder.app.reminders.RestoreJobService;
import ru.voicereminder.app.reminders.VoskRecognitionPlugin;

public class MainActivity extends BridgeActivity {
    /**
     * Системная кнопка «Назад».
     *
     * Раньше её не обрабатывали вообще: из «Событий» и «Настроек» она
     * закрывала приложение целиком, а не возвращала на главный экран.
     * Человек оказывался вне приложения, хотя хотел вернуться на шаг назад.
     *
     * Решение принимает веб-часть: только она знает, открыто ли модальное
     * окно, на какой вкладке человек и идёт ли запись. Нативная сторона
     * спрашивает window.__remindeBack() и завершает приложение лишь тогда,
     * когда веб-часть ответит, что назад возвращаться некуда.
     */
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(ReminderPlugin.class);
        registerPlugin(VoskRecognitionPlugin.class);
        super.onCreate(state);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = bridge != null ? bridge.getWebView() : null;
                if (view == null) {
                    releaseAndExit();
                    return;
                }
                try {
                    view.evaluateJavascript(
                        "(function(){try{return window.__remindeBack&&window.__remindeBack()?'handled':'exit';}catch(e){return 'exit';}})()",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                if (value != null && value.contains("handled")) return;
                                releaseAndExit();
                            }
                        });
                } catch (Exception e) {
                    releaseAndExit();
                }
            }
        });

        // Страховка для напоминаний, которые могли потеряться после
        // перезагрузки. На части прошивок (Xiaomi, Huawei) система отбрасывает
        // трансляцию BOOT_COMPLETED, если приложение давно не открывали, и
        // напоминания остаются непоставленными. Периодическое задание
        // возвращает их в строй без участия человека. Ставится при каждом
        // запуске — повторный вызов безопасен.
        RestoreJobService.ensureScheduled(getApplicationContext());
    }

    /**
     * Уводит приложение в фон.
     *
     * Просто вызвать onBackPressed() заново нельзя: он снова упрётся в этот
     * же обработчик и уйдёт по кругу. moveTaskToBack вместо finish — чтобы
     * возврат в приложение оставался мгновенным: напоминания живут в
     * AlarmManager и от закрытия окна не зависят, но повторный холодный
     * запуск WebView заметен.
     */
    private void releaseAndExit() {
        runOnUiThread(() -> moveTaskToBack(true));
    }
}