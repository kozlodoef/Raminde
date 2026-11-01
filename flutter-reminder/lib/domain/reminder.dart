// lib/domain/reminder.dart — модель напоминания.
//
// Порт структуры из React-версии (App.jsx + storage.js): id, текст, момент
// срабатывания, повторы, выполнено ли. Хранение — SQLite (см. data/store.dart),
// а не localStorage: это было главным архитектурным риском старой версии.

/// Напоминание (аналог записи storage.js).
class Reminder {
  final String id;

  /// Текст, который произнёс пользователь или набрал вручную.
  final String text;

  /// Момент первого срабатывания.
  final DateTime when;

  /// Сколько раз ещё повторить после срабатывания (0 — однократно).
  final int repeats;

  /// Интервал повтора в минутах (для PRO с несколькими повторами).
  final int repeatEveryMin;

  /// Выполнено/удалено пользователем — не планируем и не показываем.
  final bool done;

  /// Идентификатор нативной нотификации (для отмены будильника).
  final int notificationId;

  const Reminder({
    required this.id,
    required this.text,
    required this.when,
    this.repeats = 0,
    this.repeatEveryMin = 0,
    this.done = false,
    this.notificationId = 0,
  });

  Reminder copyWith({
    String? text,
    DateTime? when,
    int? repeats,
    int? repeatEveryMin,
    bool? done,
    int? notificationId,
  }) =>
      Reminder(
        id: id,
        text: text ?? this.text,
        when: when ?? this.when,
        repeats: repeats ?? this.repeats,
        repeatEveryMin: repeatEveryMin ?? this.repeatEveryMin,
        done: done ?? this.done,
        notificationId: notificationId ?? this.notificationId,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'text': text,
        'when_ms': when.millisecondsSinceEpoch,
        'repeats': repeats,
        'repeat_every_min': repeatEveryMin,
        'done': done ? 1 : 0,
        'notification_id': notificationId,
      };

  factory Reminder.fromRow(Map<String, Object?> row) => Reminder(
        id: row['id'] as String,
        text: row['text'] as String,
        when: DateTime.fromMillisecondsSinceEpoch((row['when_ms'] as num).toInt()),
        repeats: (row['repeats'] as num?)?.toInt() ?? 0,
        repeatEveryMin: (row['repeat_every_min'] as num?)?.toInt() ?? 0,
        done: ((row['done'] as num?)?.toInt() ?? 0) == 1,
        notificationId: (row['notification_id'] as num?)?.toInt() ?? 0,
      );
}

/// Короткий уникальный id — тот же алгоритм, что uid() в storage.js.
String newId() {
  final ts = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  final rnd = (DateTime.now().microsecond * 977 % 100000)
      .toRadixString(36)
      .padLeft(5, '0');
  return '$ts$rnd';
}
