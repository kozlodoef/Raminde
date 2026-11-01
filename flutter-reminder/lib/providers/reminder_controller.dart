// lib/providers/reminder_controller.dart — связующий слой UI <-> домен/сервисы.
//
// Этапы 4-6 плана (логика контроллера). Держит список напоминаний, статус
// PRO и операции над ними: создание (с проверкой freemium-лимита), удаление,
// «готово», планирование повторов, голосовое добавление.
//
// Сделан на ChangeNotifier без provider-пакета — достаточно ValueListenableBuilder
// в UI; меньше зависимостей для массового APK.

import 'package:flutter/foundation.dart';

import '../data/store.dart';
import '../domain/access.dart';
import '../domain/reminder.dart';
import '../domain/scheduler.dart';
import '../domain/time_parser.dart';
import '../services/notifications.dart';
import '../services/pro_access.dart';

/// Результат попытки добавить напоминание — чтобы UI показал правильное
/// сообщение (в т.ч. апселл в PRO при упоре в лимит).
enum AddOutcome { created, needTime, limitReached, repeatBlocked }

class AddResult {
  final AddOutcome outcome;
  final Reminder? reminder;
  final ParseResult? parsed;
  const AddResult(this.outcome, {this.reminder, this.parsed});
}

class ReminderController extends ChangeNotifier {
  final Store store;
  final NotificationService notifications;
  final ProAccessService proAccess;

  List<Reminder> reminders = const [];
  AccessStatus access = const AccessStatus();
  bool busy = true;

  ReminderController({
    required this.store,
    required this.notifications,
    required this.proAccess,
  });

  bool get isPro => access.isPro;

  /// Полная инициализация при старте приложения:
  /// 1) статус PRO с сервера; 2) загрузка БД; 3) проверка точных алармов;
  /// 4) показ просроченных напоминаний (телефон был выключен).
  Future<void> bootstrap() async {
    try {
      access = await proAccess.refresh();
      reminders = await store.activeReminders();
      await _rescheduleAll();
      final due = dueReminders(reminders);
      for (final r in due) {
        await notifications.showImmediate(_nid(r), r.text);
        await _advanceOrComplete(r);
      }
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  int _nid(Reminder r) =>
      r.notificationId != 0 ? r.notificationId : r.id.hashCode.abs() + 1;

  /// Перепланировать все активные напоминания (после ребута телефона,
  /// смены часового пояса или правки). AlarmManager-алармы переживают
  /// перезагрузку только если они поставлены через setExactAndAllowWhileIdle —
  /// flutter_local_notifications делает это сам, но после обновления системы
  /// часть алармов теряется, поэтому перестраховываемся при каждом старте.
  Future<void> _rescheduleAll() async {
    for (final r in reminders) {
      if (r.when.isAfter(DateTime.now())) {
        final nid = await notifications.schedule(r);
        if (nid != r.notificationId) {
          await store.saveReminder(r.copyWith(notificationId: nid));
        }
      }
    }
    reminders = await store.activeReminders();
  }

  /// Добавить напоминание из распознанной фразы (голос или ручной ввод).
  Future<AddResult> addFromPhrase(String phrase) async {
    final parsed = parseReminder(phrase, DateTime.now());
    if (parsed.when == null || !parsed.timeFound && parsed.when == null) {
      return AddResult(AddOutcome.needTime, parsed: parsed);
    }
    return create(text: parsed.text, when: parsed.when!);
  }

  /// Создать напоминание с явными параметрами; проверяет freemium-лимиты.
  Future<AddResult> create({
    required String text,
    required DateTime when,
    int repeats = 0,
    int repeatEveryMin = 0,
  }) async {
    final count = await store.activeCount();
    if (!canCreateReminder(count, isPro)) {
      return const AddResult(AddOutcome.limitReached);
    }
    if (!canRepeat(isPro, repeats)) {
      return const AddResult(AddOutcome.repeatBlocked);
    }
    final r = Reminder(
      id: newId(),
      text: text.isEmpty ? 'Напоминание' : text,
      when: when,
      repeats: repeats,
      repeatEveryMin: repeatEveryMin,
    );
    final nid = await notifications.schedule(r);
    final saved = await store.saveReminder(r.copyWith(notificationId: nid));
    reminders = await store.activeReminders();
    notifyListeners();
    return AddResult(AddOutcome.created, reminder: saved);
  }

  /// Отметить выполненным: отменяем будильник; если есть повторы — ставим следующий.
  Future<void> complete(String id) async {
    final r = reminders.firstWhere((x) => x.id == id);
    await notifications.cancel(_nid(r));
    await _advanceOrComplete(r);
    reminders = await store.activeReminders();
    notifyListeners();
  }

  Future<void> _advanceOrComplete(Reminder r) async {
    final next = nextOccurrence(r, DateTime.now());
    if (next != null && r.repeats > 1) {
      final updated = r.copyWith(
        when: next,
        repeats: r.repeats - 1,
      );
      final nid = await notifications.schedule(updated);
      await store.saveReminder(updated.copyWith(notificationId: nid));
    } else if (next != null && r.repeats == 1) {
      // бесплатный одиночный повтор уже использован
      await store.markDone(r.id);
    } else {
      await store.markDone(r.id);
    }
  }

  Future<void> remove(String id) async {
    final r = reminders.firstWhere((x) => x.id == id);
    await notifications.cancel(_nid(r));
    await store.deleteReminder(id);
    reminders = await store.activeReminders();
    notifyListeners();
  }

  /// Обновить статус PRO (кнопка «Купил PRO» / после verifyPurchase).
  Future<void> refreshAccess() async {
    access = await proAccess.refresh();
    // После покупки стоит перепланировать повторы, которые раньше блокировались.
    await _rescheduleAll();
    notifyListeners();
  }

  /// Остаток бесплатных слотов — для бейджа «N из 3» в UI.
  int get freeSlotsLeft => isPro
      ? -1
      : (freeReminderLimit - reminders.length).clamp(0, freeReminderLimit);
}
