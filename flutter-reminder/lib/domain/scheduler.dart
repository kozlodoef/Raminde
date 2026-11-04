// lib/domain/scheduler.dart — когда ставить будильник.
//
// Полный порт src/lib/scheduler.js + native.js#toTime. planTimer сохранён и в
// Flutter-версии: хотя точные алармы отдаются системе (AlarmManager), та же
// функция используется для «заглушек» на далёкие даты и для защиты от битых
// данных (new Date(null) в JS ставил мгновенный таймер — то же правило здесь
// записано ровно в одном месте, toTime).

import 'reminder.dart';

/// Максимальная задержка setTimeout / безопасного таймера: 2^31 - 1 мс (~24.8 дня).
const int maxTimeout = 2147483647;

/// Нормализация момента срабатывания — порт toTime() из native.js.
/// Принимает DateTime, ISO-строку или число миллисекунд; возвращает null для
/// некорректных данных (пустая строка, мусор, объект неизвестного типа).
int? toTime(Object? when) {
  if (when == null) return null;
  if (when is DateTime) return when.millisecondsSinceEpoch;
  if (when is int) return when;
  if (when is double) return when.isFinite ? when.round() : null;
  if (when is String) {
    if (when.trim().isEmpty) return null;
    final d = DateTime.tryParse(when);
    return d?.millisecondsSinceEpoch;
  }
  return null; // {} , [] и прочий мусор
}

/// Решение о планировании таймера (порт planTimer).
///   fire    — уже наступило (или почти): ставим короткую задержку
///   wait    — в пределах лимита: ставим точную задержку
///   defer   — дальше лимита: ставим «заглушку» и пересчитаем позже
///   invalid — некорректная дата: таймер ставить не нужно
({String kind, int delay}) planTimer(Object? when, [DateTime? now]) {
  final t = toTime(when);
  final nowMs = (now ?? DateTime.now()).millisecondsSinceEpoch;
  if (t == null) return (kind: 'invalid', delay: 0);
  final delay = t - nowMs;
  if (delay <= 0) return (kind: 'fire', delay: 0);
  if (delay > maxTimeout) return (kind: 'defer', delay: maxTimeout);
  return (kind: 'wait', delay: delay);
}

/// Следующий момент срабатывания с учётом повторов, или null если повторов нет.
DateTime? nextOccurrence(Reminder r, DateTime after) {
  if (r.repeats <= 0 || r.repeatEveryMin <= 0) return null;
  return after.add(Duration(minutes: r.repeatEveryMin));
}

/// Напоминания, которые уже должны были сработать (например, телефон был
/// выключен). Показываем их сразу при запуске, как dueReminders() в JS:
/// только активные (!done) с корректной датой when <= now; пустой/нулевой
/// список безопасен.
List<Reminder> dueReminders(List<Reminder>? reminders, {DateTime? now}) {
  final nowMs = (now ?? DateTime.now()).millisecondsSinceEpoch;
  return (reminders ?? const <Never>[]).where((r) {
    final t = toTime(r.when);
    return !r.done && t != null && t <= nowMs;
  }).toList();
}
