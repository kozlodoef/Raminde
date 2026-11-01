// test/domain_test.dart — тесты планировщика и freemium-логики.
import 'package:flutter_test/flutter_test.dart';
import 'package:vremya_remindme/domain/access.dart';
import 'package:vremya_remindme/domain/reminder.dart';
import 'package:vremya_remindme/domain/scheduler.dart';

void main() {
  group('scheduler', () {
    test('nextOccurrence null for one-shot', () {
      final r = Reminder(id: '1', text: 'x', when: DateTime(2026, 11, 2, 9));
      expect(nextOccurrence(r, DateTime(2026, 11, 2, 9, 1)), isNull);
    });

    test('nextOccurrence adds interval', () {
      final r = Reminder(
          id: '1',
          text: 'x',
          when: DateTime(2026, 11, 2, 9),
          repeats: 3,
          repeatEveryMin: 60);
      expect(nextOccurrence(r, DateTime(2026, 11, 2, 9)),
          DateTime(2026, 11, 2, 10));
    });

    test('dueReminders picks overdue not-done only', () {
      final now = DateTime(2026, 11, 2, 12);
      final list = [
        Reminder(id: 'a', text: 'past', when: DateTime(2026, 11, 2, 11)),
        Reminder(id: 'b', text: 'future', when: DateTime(2026, 11, 2, 13)),
        Reminder(
            id: 'c',
            text: 'done',
            when: DateTime(2026, 11, 2, 10),
            done: true),
      ];
      expect(dueReminders(list, now: now).map((r) => r.id).toList(), ['a']);
    });
  });

  group('access (freemium)', () {
    test('free limit is 3 active reminders', () {
      expect(canCreateReminder(0, false(isPro: false)), isTrue);
      expect(canCreateReminder(2, false), isTrue);
      expect(canCreateReminder(3, false), isFalse);
      expect(canCreateReminder(50, true), isTrue);
    });

    test('free repeats limited to 1', () {
      expect(canRepeat(false, 1), isTrue);
      expect(canRepeat(false, 2), isFalse);
      expect(canRepeat(true, 100), isTrue);
    });

    test('isPro respects paidUntil', () {
      const future = AccessStatus(paidUntil: 4102444800000); // 2100 год
      const expired = AccessStatus(paidUntil: 1);
      const none = AccessStatus();
      expect(future.isPro, isTrue);
      expect(expired.isPro, isFalse);
      expect(none.isPro, isFalse);
    });

    test('json roundtrip', () {
      final a = const AccessStatus(paidUntil: 123);
      expect(AccessStatus.fromJson(a.toJson()).paidUntil, 123);
    });
  });

  group('reminder model', () {
    test('row roundtrip', () {
      final r = Reminder(
          id: 'x1',
          text: 'Полить цветы',
          when: DateTime(2026, 11, 2, 9, 30),
          repeats: 2,
          repeatEveryMin: 1440,
          notificationId: 7);
      final back = Reminder.fromRow(r.toRow());
      expect(back.id, r.id);
      expect(back.text, r.text);
      expect(back.when, r.when);
      expect(back.repeats, 2);
      expect(back.repeatEveryMin, 1440);
      expect(back.notificationId, 7);
      expect(back.done, false);
    });

    test('newId unique-ish', () {
      expect(newId() != newId(), isTrue);
    });
  });
}
