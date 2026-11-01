// test/time_parser_test.dart — порт test-parser.mjs из JS-версии.
//
// Запуск (на машине с Flutter SDK):
//   cd flutter-reminder && flutter test
//
// ВАЖНО про точность: fmt выводит минуты без секунд, а относительные фразы
// отсчитываются от «сейчас» в момент разбора. Поэтому для таких случаев задан
// допуск в минутах — иначе тест ловил бы переход через границу минуты.
// ВАЖНО: парсер и его тесты не зависят от Flutter, поэтому запускаются и
// «чистым» Dart SDK без Flutter (см. test/run_dart_tests.dart):
//   dart run test/run_dart_tests.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ru_vremya_remindme/domain/time_parser.dart';

// Fixed clock: absolute-date expectations must not change after 15 October.
final now = DateTime(2026, 10, 7, 12, 0, 0);

String p2(num n) => n.toInt().toString().padLeft(2, '0');
String fmt(DateTime? d) => d == null
    ? 'null'
    : '${d.year}-${p2(d.month)}-${p2(d.day)} ${p2(d.hour)}:${p2(d.minute)}';

DateTime addDays(DateTime d, int n) =>
    DateTime(d.year, d.month, d.day + n, d.hour, d.minute, d.second);

String at(int dayShift, int h, [int m = 0]) {
  final d = addDays(now, dayShift);
  return fmt(DateTime(d.year, d.month, d.day, h, m));
}

String inMin(int n) => fmt(now.add(Duration(minutes: n)));

String atClock(int h, [int m = 0]) {
  var d = DateTime(now.year, now.month, now.day, h, m);
  if (!d.isAfter(now)) d = d.add(const Duration(days: 1));
  return fmt(d);
}

const tol = 2; // допуск для относительных фраз, в минутах

class Case {
  final String phrase, expectText;
  final String? expectWhen;
  final int? tolMin;
  const Case(this.phrase, this.expectWhen, this.expectText, [this.tolMin]);
}

final cases = <Case>[
  // --- базовые случаи ---
  Case('Напомни мне завтра в семь утра полить цветы', at(1, 7), 'Полить цветы', 1),
  Case('Напомнить через два часа позвонить маме', inMin(120), 'Позвонить маме', tol),
  Case('напомни 15 октября в 10 утра сдать отчёт', '2026-10-15 10:00', 'Сдать отчет', 1),
  Case('напомни сегодня без четверти шесть забрать ребёнка из школы', null, 'Забрать ребенка из школы'),
  Case('Напомни завтра в половине десятого позвонить врачу', at(1, 9, 30), 'Позвонить врачу', 1),
  Case('напомни через полчаса выпить таблетки', inMin(30), 'Выпить таблетки', tol),
  Case('Напомни послезавтра в 3 дня встречу с директором', at(2, 15), 'Встречу с директором', 1),
  Case('Напомни в десять вечера позвонить бабушке', atClock(22), 'Позвонить бабушке', 1),
  Case('Напомни в 15:30 созвониться с командой', atClock(15, 30), 'Созвониться с командой', 1),
  Case('Напомни полшестого вечером покормить кота', atClock(17, 30), 'Покормить кота', 1),
  Case('Напомни в пятницу утром стирку', null, 'Стирку'),

  // --- относительные: единица без числа ---
  Case('Напомни через час позвонить', inMin(60), 'Позвонить', tol),
  Case('Напомни через минуту выключить', inMin(1), 'Выключить', tol),
  Case('Напомни через неделю сдать отчёт', inMin(7 * 1440), 'Сдать отчет', tol),
  Case('Напомни через месяц продлить подписку', null, 'Продлить подписку'),

  // --- относительные: круглые десятки ---
  Case('Напомни через тридцать минут проверить', inMin(30), 'Проверить', tol),
  Case('Напомни через двадцать минут выйти', inMin(20), 'Выйти', tol),
  Case('Напомни через сорок минут обед', inMin(40), 'Обед', tol),

  // --- относительные: составные числа ---
  Case('Напомни через двадцать пять минут', inMin(25), 'Напоминание', tol),
  Case('Напомни через тридцать пять минут', inMin(35), 'Напоминание', tol),
  Case('Напомни через сорок пять минут', inMin(45), 'Напоминание', tol),

  // --- относительные: прочие формы ---
  Case('Напомни через две минуты', inMin(2), 'Напоминание', tol),
  Case('Напомни через 45 минут', inMin(45), 'Напоминание', tol),
  Case('Напомни через полтора часа', inMin(90), 'Напоминание', tol),
  Case('Напомни через три дня встречу', inMin(3 * 1440), 'Встречу', tol),

  // --- части суток без явного часа ---
  Case('Напомни завтра утром зарядка', at(1, 9), 'Зарядка', 1),
  Case('Напомни завтра днем обед', at(1, 15), 'Обед', 1),
  Case('Напомни завтра вечером кино', at(1, 19), 'Кино', 1),
  Case('Напомни в пятницу вечером гости', null, 'Гости'),

  // --- абсолютные даты ---
  Case('Напомни 25 декабря купить подарки', null, 'Купить подарки'),
  Case('Напомни 25 декабря 2026 в 12:00', '2026-12-25 12:00', 'Напоминание', 1),
  Case('Напомни 3 января в 10 утра', null, 'Напоминание'),
  Case('Напомни 1 сентября в 8:30 линейка', null, 'Линейка'),

  // --- время ---
  Case('Напомни в 10:05 позвонить', null, 'Позвонить'),
  Case('Напомни в 23:59 выключить', atClock(23, 59), 'Выключить', 1),
  Case('Напомни в 7 вечера', atClock(19), 'Напоминание', 1),
  Case('Напомни в полдень обед', atClock(12), 'Обед', 1),
  Case('Напомни в полночь', null, 'Напоминание'),
  Case('Напомни в 5 часов вечера', atClock(17), 'Напоминание', 1),
  Case('Напомни в понедельник утром планёрка', null, 'Планерка'),
  Case('Напомни в воскресенье в 12:00', null, 'Напоминание'),

  // --- без времени и даты ---
  Case('Напомни позвонить маме', null, 'Позвонить маме'),
];

String norm(String x) => x.toLowerCase().replaceAll('ё', 'е');

DateTime _parseFmt(String s) {
  final m = RegExp(r'^(\d+)-(\d+)-(\d+) (\d+):(\d+)$').firstMatch(s)!;
  return DateTime(int.parse(m.group(1)!), int.parse(m.group(2)!),
      int.parse(m.group(3)!), int.parse(m.group(4)!), int.parse(m.group(5)!));
}

void main() {
  for (final c in cases) {
    test(c.phrase, () {
      final r = parseReminder(c.phrase, now);
      final got = fmt(r.when);
      expect(r.when, isNotNull, reason: 'parser returned null when');
      if (c.expectWhen != null && c.tolMin != null) {
        final exp = _parseFmt(c.expectWhen!);
        final diff = r.when!.difference(exp).inMinutes.abs();
        expect(diff <= c.tolMin!, isTrue,
            reason: '$got vs ${c.expectWhen} (Δ=${diff}мин > ${c.tolMin})');
      } else if (c.expectWhen != null) {
        expect(got, c.expectWhen);
      }
      expect(
        norm(r.text).contains(norm(c.expectText).substring(0, c.expectText.length.clamp(0, 8))),
        isTrue,
        reason: 'text="${r.text}" expected to contain "${c.expectText}"',
      );
    });
  }
}
