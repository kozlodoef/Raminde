// lib/services/notifications.dart — точные будильники через AlarmManager.
//
// Этап 4 плана. Ключевое отличие от Capacitor-версии: срабатывание больше
// не зависит от живого WebView/JS-таймера. flutter_local_notifications на
// Android использует AlarmManager.setExactAndAllowWhileIdle — напоминание
// придёт даже при убитом приложении и в режиме экономии батареи.
//
// Требования RuStore/Android 12+:
//   - разрешение USE_EXACT_ALARM (см. android/app/src/main/AndroidManifest.xml);
//   - канал уведомлений с высокой важностью (создаётся ниже);
//   - полноэкранный alert + vibration, чтобы разбудить пользователя.
//
// Повторы: после срабатывания приложение перепланирует следующий повтор
// (domain/scheduler.dart: nextOccurrence) — это делает ReminderNotifier.reschedule.

import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../domain/reminder.dart';

class NotificationService {
  static const channelId = 'reminders';
  static const _channelName = 'Напоминания';
  static const _channelDesc =
      'Точные напоминания о делах: звук, баннер и полноэкранный вызов';

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _inited = false;

  Future<void> init() async {
    if (_inited) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );
    await _ensureChannel();
    _inited = true;
  }

  Future<void> _ensureChannel() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(const AndroidNotificationChannel(
      channelId,
      _channelName,
      description: _channelDesc,
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      enableLights: true,
    ));
  }

  /// Уведомление о уже просроченном напоминании (телефон был выключен).
  Future<void> showImmediate(int id, String text) async {
    await init();
    await _plugin.show(
      id,
      'Напоминание',
      text,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          _channelName,
          importance: Importance.max,
          priority: Priority.high,
        ),
      ),
    );
  }

  /// Поставить точный будильник на r.when. Возвращает id уведомления —
  /// он сохраняется в напоминании, чтобы можно было отменить при правке/удалении.
  Future<int> schedule(Reminder r) async {
    await init();
    final androidDetails = AndroidNotificationDetails(
      channelId,
      _channelName,
      channelDescription: _channelDesc,
      importance: Importance.max,
      priority: Priority.high,
      category: AndroidNotificationCategory.alarm,
      fullScreenIntent: true, // будит экраном, как обычный будильник
      playSound: true,
      enableVibration: true,
      ticker: 'Напоминание',
    );
    // notificationId должен быть стабильным для возможности отмены;
    // используем сохранённый id или генерируем из строкового id.
    final nid = r.notificationId != 0 ? r.notificationId : _deriveNid(r.id);
    await _plugin.zonedSchedule(
      nid,
      'Напоминание',
      r.text,
      // В v18 API принимает DateTime в локальной таймзоне timezone-пакета;
      // приведение делает вызывающий код (ReminderController), чтобы здесь
      // не дублировать логику tz.
      r.localDateTimeForAlarm(),
      NotificationDetails(android: androidDetails),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
    );
    return nid;
  }

  /// Отменить будильник по id уведомления.
  Future<void> cancel(int notificationId) async {
    await init();
    await _plugin.cancel(notificationId);
  }

  /// Стабильный положительный int32 из строкового id (FNV-1a).
  static int _deriveNid(String id) {
    var h = 0x811c9dc5;
    for (final c in id.codeUnits) {
      h ^= c;
      h = (h * 0x01000193) & 0xFFFFFFFF;
    }
    return (h & 0x7FFFFFFF) | 1; // nonzero, fits positive int32
  }
}

/// Небольшой хелпер: Reminder -> DateTime для zonedSchedule.
extension ReminderAlarm on Reminder {
  /// Для одноразовых — просто when. Для повторяющихся планирование
  /// следующего повтора делает контроллер после срабатывания.
  DateTime localDateTimeForAlarm() => when;
}
