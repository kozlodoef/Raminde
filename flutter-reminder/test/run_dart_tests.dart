// test/run_dart_tests.dart — прогон тестов доменной логики чистым Dart SDK,
// без Flutter (для CI/сред, где Flutter SDK недоступен).
//
// Запуск:
//   dart run test/run_dart_tests.dart
//
// Тесты в flutter-формате (test/time_parser_test.dart, test/domain_test.dart)
// запускаются командой `flutter test` на машине с Flutter SDK. Здесь те же
// проверки переписаны на assert + прямой импорт lib/domain/*.dart, чтобы не
// зависеть от пакета flutter_test.

import 'package:ru_vremya_remindme/domain/access.dart';
import 'package:ru_vremya_remindme/domain/reminder.dart';
import 'package:ru_vremya_remindme/domain/scheduler.dart';
import 'package:ru_vremya_remindme/domain/time_parser.dart';

// === ОБЩИЙ БЛОК КЕЙСОВ (единый источник — test/time_parser_test.dart) ===
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
// === КОНЕЦ ОБЩЕГО БЛОКА ===

int _passed = 0;
int _failed = 0;
final List<String> _failures = [];

void check(String name, Object body) {
  // body — либо bool, либо bool Function() (для отложенных проверок).
  final bool Function() f = body is bool ? () => body : body as bool Function();
  try {
    if (f()) {
      _passed++;
    } else {
      _failed++;
      _failures.add('FAIL: $name — вернул false');
    }
  } catch (e) {
    _failed++;
    _failures.add('FAIL: $name — исключение: $e');
  }
}

// --- утилиты форматирования (как в time_parser_test.dart) ---
// (утилиты и кейсы — в общем блоке выше)


String norm(String x) => x.toLowerCase().replaceAll('ё', 'е');

DateTime _parseFmt(String s) {
  final m = RegExp(r'^(\d+)-(\d+)-(\d+) (\d+):(\d+)$').firstMatch(s)!;
  return DateTime(int.parse(m.group(1)!), int.parse(m.group(2)!),
      int.parse(m.group(3)!), int.parse(m.group(4)!), int.parse(m.group(5)!));
}

void main() {
  // ---- Парсер времени ----
  for (final c in cases) {
    check(c.phrase, () {
      final r = parseReminder(c.phrase, now);
      final got = fmt(r.when);
      if (r.when == null) throw StateError('parser returned null when');
      if (c.expectWhen != null && c.tolMin != null) {
        final exp = _parseFmt(c.expectWhen!);
        final diff = r.when!.difference(exp).inMinutes.abs();
        if (diff > c.tolMin!) {
          throw StateError('$got vs ${c.expectWhen} (Δ=${diff}мин > ${c.tolMin})');
        }
      } else if (c.expectWhen != null) {
        if (got != c.expectWhen) {
          throw StateError('when=$got expected=${c.expectWhen}');
        }
      }
      final probe = c.expectText.substring(0, c.expectText.length.clamp(0, 8));
      if (!norm(r.text).contains(norm(probe))) {
        throw StateError('text="${r.text}" expected to contain "${c.expectText}"');
      }
      return true;
    });
  }

  // ---- Scheduler ----
  check('scheduler: nextOccurrence null for one-shot', () {
    final r = Reminder(id: '1', text: 'x', when: DateTime(2026, 11, 2, 9));
    return nextOccurrence(r, DateTime(2026, 11, 2, 9, 1)) == null;
  });

  check('scheduler: nextOccurrence adds interval', () {
    final r = Reminder(
        id: '1',
        text: 'x',
        when: DateTime(2026, 11, 2, 9),
        repeats: 3,
        repeatEveryMin: 60);
    return nextOccurrence(r, DateTime(2026, 11, 2, 9)) ==
        DateTime(2026, 11, 2, 10);
  });

  check('scheduler: dueReminders picks overdue not-done only', () {
    final t = DateTime(2026, 11, 2, 12);
    final list = [
      Reminder(id: 'a', text: 'past', when: DateTime(2026, 11, 2, 11)),
      Reminder(id: 'b', text: 'future', when: DateTime(2026, 11, 2, 13)),
      Reminder(id: 'c', text: 'done', when: DateTime(2026, 11, 2, 10), done: true),
    ];
    final ids = dueReminders(list, now: t).map((r) => r.id).toList();
    if (ids.length != 1 || ids.first != 'a') {
      throw StateError('expected [a], got $ids');
    }
    return true;
  });

  // ---- Access (freemium) ----
  check('access: free limit is 3 active reminders', () =>
      canCreateReminder(0, false) &&
      canCreateReminder(2, false) &&
      !canCreateReminder(3, false) &&
      canCreateReminder(50, true));

  check('access: free repeats limited to 1', () =>
      canRepeat(false, 1) && !canRepeat(false, 2) && canRepeat(true, 100));

  check('access: isPro respects paidUntil', () {
    const future = AccessStatus(paidUntil: 4102444800000); // 2100 год
    const expired = AccessStatus(paidUntil: 1);
    const none = AccessStatus();
    return future.isPro && !expired.isPro && !none.isPro;
  });

  check('access: json roundtrip', () =>
      AccessStatus.fromJson(const AccessStatus(paidUntil: 123).toJson()).paidUntil == 123);

  // ---- Reminder model ----
  check('reminder: row roundtrip', () {
    final r = Reminder(
        id: 'x1',
        text: 'Полить цветы',
        when: DateTime(2026, 11, 2, 9, 30),
        repeats: 2,
        repeatEveryMin: 1440,
        notificationId: 7);
    final back = Reminder.fromRow(r.toRow());
    return back.id == r.id &&
        back.text == r.text &&
        back.when == r.when &&
        back.repeats == 2 &&
        back.repeatEveryMin == 1440 &&
        back.notificationId == 7 &&
        back.done == false;
  });

  check('reminder: newId unique-ish', () => newId() != newId());

  // =====================================================================
  // Порт test-scheduler.mjs (23 проверки JS-харнеса) — planTimer/toTime.
  // В Dart DateTime локальный, поэтому at(y,m,d,hh,mm) = new Date(...) в JS.
  // =====================================================================
  final MIN = const Duration(minutes: 1).inMilliseconds;
  final HOUR = const Duration(hours: 1).inMilliseconds;
  final DAY = const Duration(days: 1).inMilliseconds;
  DateTime at(int y, int m, int d, int hh, [int mm = 0]) =>
      DateTime(y, m, d, hh, mm);

  ({String kind, int delay}) pt(Object? when, DateTime nowArg) =>
      planTimer(when, nowArg);

  // --- 1. Напоминание на 23:59 того же дня ---
  {
    final n = at(2026, 10, 7, 12, 0);
    final p = pt(at(2026, 10, 7, 23, 59), n);
    check('planTimer: 23:59 того же дня → wait', () => p.kind == 'wait');
    check('planTimer: 23:59 задержка = 11ч59м',
        p.delay == 11 * HOUR + 59 * MIN);
  }

  // --- 2. Переход через сутки: 23:59 → 00:01 ---
  {
    final n = at(2026, 10, 7, 23, 59);
    final p = pt(at(2026, 10, 8, 0, 1), n);
    check('planTimer: через полночь (23:59 → 00:01) = 2 мин',
        p.kind == 'wait' && p.delay == 2 * MIN);
  }

  // --- 3. Ровно сейчас ---
  {
    final n = at(2026, 10, 7, 12, 0);
    check('planTimer: ровно сейчас → fire', pt(n, n).kind == 'fire');
  }

  // --- 4. Просроченное (в т.ч. на сутки) ---
  {
    final n = at(2026, 10, 7, 12, 0);
    final p = pt(at(2026, 10, 6, 9, 0), n);
    check('planTimer: просроченное на сутки → fire', p.kind == 'fire');
    check('planTimer: просроченное — задержка без переполнения',
        p.delay == 0);
  }

  // --- 5. Граница лимита maxTimeout ---
  {
    final n = at(2026, 10, 7, 12, 0);
    check('planTimer: ровно на лимите → wait',
        pt(DateTime.fromMillisecondsSinceEpoch(
            n.millisecondsSinceEpoch + maxTimeout), n).kind == 'wait');
    check('planTimer: на 1 мс больше лимита → defer',
        pt(DateTime.fromMillisecondsSinceEpoch(
            n.millisecondsSinceEpoch + maxTimeout + 1), n).kind == 'defer');
  }

  // --- 6. Очень далёкое будущее ---
  {
    final n = at(2026, 10, 7, 12, 0);
    final p = pt(at(2027, 10, 7, 12, 0), n); // +1 год
    check('planTimer: через год → defer', p.kind == 'defer');
    check('planTimer: defer — задержка = maxTimeout', p.delay == maxTimeout);
    check('planTimer: год > лимита (запас корректен)', 365 * DAY > maxTimeout);
  }

  // --- 7. Некорректные данные не должны ставить «мгновенный» таймер ---
  {
    final n = at(2026, 10, 7, 12, 0);
    for (final bad in <Object?>[
      'не дата', '', null, <String, String>{}, double.nan, <int>[1]
    ]) {
      final label = bad is Map ? '{}' : bad is List ? '[1]' : '$bad';
      check('planTimer: некорректная дата ($label) → invalid',
          pt(bad, n).kind == 'invalid');
    }
  }

  // --- 8. Строки ISO (как хранит приложение) ---
  {
    final n = at(2026, 10, 7, 12, 0);
    final iso = at(2026, 10, 7, 13, 30).toUtc().toIso8601String();
    // toTime парсит UTC-ISO → локальное время: эквивалент new Date(iso) в JS.
    final p = pt(iso, n);
    check('planTimer: ISO-строка → wait 1ч30м',
        p.kind == 'wait' && p.delay == 90 * MIN);
    check('planTimer: ISO-строка просрочена → fire',
        pt(DateTime.fromMillisecondsSinceEpoch(n.millisecondsSinceEpoch - 1000)
            .toUtc()
            .toIso8601String(), n).kind == 'fire');
  }

  // --- 9. dueReminders: что показывать сразу ---
  {
    final n = at(2026, 10, 7, 12, 0);
    final list = [
      Reminder(id: 'a', text: '', when: n.subtract(const Duration(seconds: 5))),
      Reminder(id: 'b', text: '', when: n.add(const Duration(hours: 1))),
      Reminder(id: 'c', text: '', when: n.subtract(const Duration(seconds: 5)), done: true),
      Reminder(id: 'e', text: '', when: n),
    ];
    final ids = dueReminders(list, now: n).map((r) => r.id).toList();
    check('dueReminders: только просроченные и активные',
        ids.join(',') == 'a,e');
    check('dueReminders: пустой список безопасен',
        dueReminders([], now: n).isEmpty);
    check('dueReminders: null безопасен', dueReminders(null, now: n).isEmpty);
  }

  // --- 10. Смена суток на границе месяца и года ---
  {
    final n = at(2026, 12, 31, 23, 30);
    final p = pt(at(2027, 1, 1, 0, 15), n);
    check('planTimer: через Новый год = 45 мин',
        p.kind == 'wait' && p.delay == 45 * MIN);
  }

  // =====================================================================
  // Дополнительные кейсы парсера: покрытие ветвей timeParser.js, которые
  // не были в исходном test-parser.mjs (42 кейса). Ожидания получены
  // прогоном эталонного JS-парсера при зафиксированной дате
  // now = 2026-10-07 12:00 — то есть это порт поведения, а не догадка.
  // Формат: [фраза, ожидаемое when ("—" — зависит от времени), текст, допуск]
  // =====================================================================
  // Формат: [фраза, ожидаемое when, ожидаемый текст]. Все ожидания — это
  // ЭТАЛОННЫЕ выходы JS-парсера (voice-reminder/src/lib/timeParser.js) при
  // зафиксированном now (2026-10-07 12:00), полученные прогоном node; они не
  // зависят от системных часов и потому воспроизводимы на любой машине.
  // Если Dart-порт расходится с эталоном — это баг порта, а не теста.
  final extraCases = <List<String>>[
    ['напомни через час', '2026-10-07 13:00', 'Напоминание'],
    ['напомни через полтора часа', '2026-10-07 13:30', 'Напоминание'],
    ['напомни через полторы минуты', '2026-10-07 12:02', 'Напоминание'],
    ['напомни через 90 минут', '2026-10-07 13:30', 'Напоминание'],
    ['напомни через 25 минут', '2026-10-07 12:25', 'Напоминание'],
    ['напомни через два дня', '2026-10-09 12:00', 'Напоминание'],
    ['напомни через две недели', '2026-10-21 12:00', 'Напоминание'],
    ['напомни через три секунды', '2026-10-07 12:00', 'Напоминание'],
    ['напомни завтра', '2026-10-08 00:00', 'Напоминание'],
    // Эталон JS (node, now=2026-10-07 12:00): when=2026-10-07 19:00, text="Напоминание"
    ['напомни сегодня вечером', '2026-10-07 19:00', 'Напоминание'],
    ['напомни вчера утром', '2026-10-06 09:00', 'Напоминание'],
    ['напомни в час ночи позвонить', '2026-10-08 01:00', 'Позвонить'],
    ['напомни в пять утра зарядка', '2026-10-08 05:00', 'Зарядка'],
    ['напомни в шесть сорок', '2026-10-08 06:00', 'Сорок'],
    ['напомни в десять с четвертью', '2026-10-08 10:15', 'Напоминание'],
    ['напомни без двадцати пять', '2026-10-07 13:00', 'Без двадцати пять'],
    ['напомни в половине восьмого', '2026-10-08 07:30', 'Напоминание'],
    ['напомни в полдевятого', '2026-10-08 08:30', 'Напоминание'],
    ['напомни ровно в восемь', '2026-10-08 08:00', 'Ровно'],
    ['напомни где-то в семь', '2026-10-08 07:00', 'Напоминание'],
    ['напомни около десяти', '2026-10-07 13:00', 'Десяти'],
    ['напомни в полночь', '2026-10-08 00:00', 'Напоминание'],
    // Эталон JS: cleanup вырезает всё слово «двенадцать» целиком, текст -> «Напоминание».
    ['напомни в двенадцать ночи', '2026-10-08 00:00', 'Напоминание'],
    ['напомни в двенадцать дня', '2026-10-08 12:00', 'Напоминание'],
    ['напомни послезавтра утром', '2026-10-09 09:00', 'Напоминание'],
    ['напомни в понедельник в 10 утра планерка', '2026-10-12 10:00', 'Планерка'],
    ['напомни в следующий вторник в 9', '2026-10-13 09:00', 'Напоминание'],
    ['напомни 15 октября', '2026-10-15 00:00', 'Напоминание'],
    ['напомни пятое ноября в 10 утра', '2026-10-08 10:00', 'Пятое ноября'],
    ['напомни 15.10 в 10 утра сдать отчет', '2026-10-15 10:00', 'Сдать отчет'],
    ['напомни 31.02 в 9 утра позвонить врачу', '', 'Такой даты не существует'],
    ['напомни завтра послезавтра', '2026-10-09 00:00', 'Завтра'],
    ['просто текст без напоминания', '2026-10-07 13:00', 'Просто текст без'],
  ];

  for (final c in extraCases) {
    check('parser+: ${c[0]}', () {
      final r = parseReminder(c[0], now);
      // Текст/ошибка. Ожидания с when='' проверяются через поле error
      // (в Dart-порту ошибки вынесены из text в ParseResult.error,
      // тогда как JS-эталон возвращает текст ошибки в поле text).
      final wantText = c[2];
      if (c[1].isEmpty && wantText == 'Такой даты не существует') {
        if (r.error != wantText) {
          throw StateError('error="${r.error}" expected "$wantText"');
        }
      } else if (!norm(r.text).contains(norm(wantText))) {
        throw StateError('text="${r.text}" expected to contain "$wantText"');
      }
      // When: пустая строка — when должен отсутствовать (случай ошибки).
      if (c[1].isEmpty) {
        if (r.when != null) {
          throw StateError('expected when=null, got ${fmt(r.when)}');
        }
      } else {
        if (r.when == null) throw StateError('when=null, expected ${c[1]}');
        final exp = _parseFmt(c[1]);
        final diff = r.when!.difference(exp).inMinutes.abs();
        if (diff > tol) {
          throw StateError('${fmt(r.when)} vs ${c[1]} (Δ=${diff}мин > $tol)');
        }
      }
      return true;
    });
  }

  // ---- Итог ----
  print('========================================');
  print('Результат: $_passed passed, $_failed failed '
      '(всего ${_passed + _failed})');
  if (_failures.isNotEmpty) {
    print('----------------------------------------');
    for (final f in _failures) {
      print(f);
    }
  }
  print('========================================');
}
