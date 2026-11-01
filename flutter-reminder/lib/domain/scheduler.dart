// lib/domain/scheduler.dart — когда ставить будильник.
//
// Порт src/lib/scheduler.js. В Flutter-версии эта логика проще: точные
// алармы отдаются системе (AlarmManager через flutter_local_notifications),
// поэтому MAX_TIMEOUT/defer из WebView-реализации не нужны. Здесь остаются
// две вещи, важные для корректности: нормализация повторов и выборка
// просроченных напоминаний при старте приложения.

import 'reminder.dart';

/// Следующий момент срабатывания с учётом повторов, или null если повторов нет.
DateTime? nextOccurrence(Reminder r, DateTime after) {
  if (r.repeats <= 0 || r.repeatEveryMin <= 0) return null;
  return after.add(Duration(minutes: r.repeatEveryMin));
}

/// Напоминания, которые уже должны были сработать (например, телефон был
/// выключен). Показываем их сразу при запуске, как dueReminders() в JS.
List<Reminder> dueReminders(List<Reminder> reminders, {DateTime? now}) {
  final t = now ?? DateTime.now();
  return reminders.where((r) => !r.done && r.when.isBefore(t)).toList();
}
