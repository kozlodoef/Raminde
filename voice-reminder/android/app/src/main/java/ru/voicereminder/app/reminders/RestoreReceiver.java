package ru.voicereminder.app.reminders;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

/** Only restores schedules. Reminder/fire/ack actions stay in the private receiver. */
public final class RestoreReceiver extends BroadcastReceiver {
    public static boolean accepts(String action) {
        return Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action);
    }
    @Override public void onReceive(Context context, Intent intent) {
        final String action = intent.getAction();
        if (!accepts(action)) return;
        final Context app = context.getApplicationContext();
        final PendingResult result = goAsync();
        new Thread(() -> {
            PowerManager.WakeLock lock = null;
            try {
                PowerManager power = app.getSystemService(PowerManager.class);
                lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "remindme:restore");
                lock.acquire(10000L);
                try (ReminderStore db = new ReminderStore(app)) { db.recordRestoreSignal(action); }
                AlarmScheduler.restore(app, action);
            } catch (Exception ex) {
                Log.e("RemindMeRestore", "Restore failed", ex);
                try (ReminderStore db = new ReminderStore(app)) {
                    db.diagnostic("Ошибка восстановления после загрузки: " + ex.getClass().getSimpleName() + ": " + ex.getMessage());
                } catch (Exception ignored) { }
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
                result.finish();
            }
        }, "remindme-restore").start();
    }
}
