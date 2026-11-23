package ru.voicereminder.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import ru.voicereminder.app.reminders.ReminderPlugin;
import ru.voicereminder.app.reminders.RestoreJobService;
import ru.voicereminder.app.reminders.VoskRecognitionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(ReminderPlugin.class);
        registerPlugin(VoskRecognitionPlugin.class);
        super.onCreate(state);

        // Страховка для напоминаний, которые могли потеряться после
        // перезагрузки. На части прошивок (Xiaomi, Huawei) система отбрасывает
        // трансляцию BOOT_COMPLETED, если приложение давно не открывали, и
        // напоминания остаются непоставленными. Периодическое задание
        // возвращает их в строй без участия человека. Ставится при каждом
        // запуске — повторный вызов безопасен.
        RestoreJobService.ensureScheduled(getApplicationContext());
    }
}
