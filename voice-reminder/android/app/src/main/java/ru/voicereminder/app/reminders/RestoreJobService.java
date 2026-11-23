package ru.voicereminder.app.reminders;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Страховка на случай, когда система не прислала трансляцию о загрузке.
 *
 * Зачем это нужно. На телефонах Xiaomi (MIUI) и некоторых других прошивках
 * приложение, которое давно не открывали, попадает в «ограниченную» категорию
 * (restricted standby bucket). В этом состоянии система просто выбрасывает
 * BOOT_COMPLETED: в журнале видно «am_broadcast_discard_app». Приложение не
 * узнаёт о перезагрузке и напоминания остаются непоставленными — человек
 * ничего не получает и не понимает почему.
 *
 * Решение. Периодическое задание, которое время от времени проверяет: есть ли
 * в базе будущие напоминания, и стоят ли они у системы. Если нет — ставит
 * заново. Ограниченная категория разрешает такие задания примерно раз в сутки,
 * и этого достаточно: напоминание всё равно вернётся в строй до срока.
 *
 * Задание не держит телефон включённым и не расходует батарею: оно просыпается
 * на несколько миллисекунд, сверяет записи с системным будильником и засыпает.
 */
public final class RestoreJobService extends JobService {
    private static final int JOB_ID = 4801;
    private static final String TAG = "RemindMeJob";

    /** Ставит задание. Повторный вызов безопасен — задание заменяется. */
    public static void ensureScheduled(Context context) {
        try {
            JobScheduler scheduler =
                (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            // Уже стоит — второй раз не нужно.
            for (JobInfo existing : scheduler.getAllPendingJobs()) {
                if (existing.getId() == JOB_ID) return;
            }
            JobInfo job = new JobInfo.Builder(
                    JOB_ID, new ComponentName(context, RestoreJobService.class))
                // Пятнадцать минут — минимальный шаг, который разрешает Android.
                // На практике в ограниченной категории задание выполняется реже,
                // но и этого хватает: срок напоминаний измеряется часами и днями.
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                .setPersisted(true)
                .build();
            scheduler.schedule(job);
        } catch (Exception e) {
            Log.e(TAG, "cannot schedule restore job", e);
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        // Работа короткая (чтение базы и пара строк в AlarmManager), поэтому
        // выполняем её прямо здесь и сразу сообщаем, что закончили.
        try {
            AlarmScheduler.restore(getApplicationContext(), "job");
        } catch (Exception e) {
            Log.e(TAG, "restore job failed", e);
        }
        return false;
    }
    @Override
    public boolean onStopJob(JobParameters params) {
        // Задание прервано системой; повторять не нужно — следующее по расписанию.
        return false;
    }
}
