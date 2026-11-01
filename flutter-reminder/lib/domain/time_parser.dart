// lib/domain/time_parser.dart — «ИИ»-парсер русской речи о дате и времени.
//
// Полный порт src/lib/timeParser.js (679 строк) из React-версии: понимает
// «завтра в 5», «через два часа», «в пятницу вечером», «15 октября в 10 утра»,
// «без четверти шесть», «полшестого», «половина десятого».
//
// Правила перенесены один-в-один, включая порядок применения. Тесты:
// test/time_parser_test.dart — порт test-parser.mjs из JS-версии.
//
// ВАЖНО: \b не работает с кириллицей, границы слов задаём явно через WB_L/WB_R.

class ParseResult {
  /// Момент срабатывания; null — если распознать не удалось.
  final DateTime? when;

  /// Текст действия после вырезания даты/времени («Полить цветы»).
  final String text;
  final bool timeFound;
  final bool dateFound;

  /// true — время предложено приблизительно.
  final bool approx;

  /// Сообщение об ошибке для UI (например, «Такой даты не существует»).
  final String? error;

  const ParseResult({
    this.when,
    this.text = '',
    this.timeFound = false,
    this.dateFound = false,
    this.approx = true,
    this.error,
  });
}

const Map<String, int> numWords = {
  'ноль': 0, 'один': 1, 'одна': 1, 'одно': 1, 'два': 2, 'две': 2,
  'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8,
  'девять': 9, 'десять': 10, 'одиннадцать': 11, 'двенадцать': 12,
};

/// Родительный падеж («которого») — для «пол-Х», «половина Х», «без N Х».
const Map<String, int> ordinals = {
  'первого': 1, 'второго': 2, 'третьего': 3, 'четвертого': 4, 'пятого': 5,
  'шестого': 6, 'седьмого': 7, 'восьмого': 8, 'девятого': 9, 'десятого': 10,
  'одиннадцатого': 11, 'двенадцатого': 12,
};

/// День недели: 0 = воскресенье (как getDay() в JS).
const Map<String, int> weekdays = {
  'понедельник': 1, 'понедельника': 1, 'понедельнику': 1,
  'вторник': 2, 'вторника': 2, 'вторнику': 2,
  'среда': 3, 'среду': 3, 'среды': 3,
  'четверг': 4, 'четверга': 4, 'четвергу': 4,
  'пятница': 5, 'пятницу': 5, 'пятницы': 5,
  'суббота': 6, 'субботу': 6, 'субботы': 6,
  'воскресенье': 0, 'воскресенья': 0, 'воскресенью': 0,
};

/// Месяц: 0-based, как getMonth() в JS.
const Map<String, int> months = {
  'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5,
  'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
};

const Map<String, String> partsOfDay = {
  'утра': 'morning', 'утром': 'morning',
  'дня': 'afternoon', 'днём': 'afternoon', 'днем': 'afternoon',
  'вечера': 'evening', 'вечером': 'evening',
  'ночи': 'night', 'ночью': 'night',
};

const Map<String, int> defaultHour = {
  'morning': 9, 'afternoon': 15, 'evening': 19, 'night': 23,
};

const Map<String, int> tens = {
  'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50,
};

String normKey(String s) => s.toLowerCase().replaceAll('ё', 'е');

/// Слово → число (цифры, слова, «двадцать пять»). Порт wordToNum().
double? wordToNum(String ww) {
  if (RegExp(r'^\d+$').hasMatch(ww)) return double.parse(ww);
  final k = normKey(ww);
  if (numWords.containsKey(k)) return numWords[k]!.toDouble();
  if (ordinals.containsKey(k)) return ordinals[k]!.toDouble();
  var val = 0;
  for (final p in k.split(RegExp(r'[\s-]+'))) {
    if (tens.containsKey(p)) {
      val += tens[p]!;
    } else if (numWords.containsKey(p)) {
      val += numWords[p]!;
    } else {
      return null;
    }
  }
  return val == 0 ? null : val.toDouble();
}

String joinKeys(Map o) => o.keys.join('|');

/// Группировка без захвата. Собираем шаблоны только через неё: при ручной
/// склейке строк потерянная скобка делает шаблон тихо неверным.
String grp(String src) => '(?:$src)';

// Граница слова, совместимая с кириллицей: перед/после слова — не буква.
const String wbL = r'(?<!\p{Ll})';
const String wbR = r'(?!\p{Ll})';
String w(String word) => '$wbL$word$wbR';

// Внимание: \w в Dart НЕ включает кириллицу, поэтому для русских окончаний
// используем явный класс. Без него шаблоны вида "час\w*" не матчат "часа".
const String ru = '[а-яё]*';

final String numAlt = r'\d{1,2}|' + joinKeys(numWords);
// Число (слово или цифра): составные «двадцать пять», круглые десятки
// «тридцать минут» и одиночные «два».
// ВАЖНО: длинные формы должны идти РАНЬШЕ коротких. Если поставить NUM_ALT
// первым, альтернатива «три» совпадёт внутри слова «тридцать» и число
// посчитается как 3 вместо 30.
final String tenWords = grp('${joinKeys(tens)}|пятьдесят');
// Полная форма «десяток [пробел/дефис число]» — как NUM_EXPR в JS:
// сначала составные («двадцать пять»), затем голое слово («тридцать»),
// затем одиночные слова/цифры. Порядок важен: короткие альтернативы не
// должны съедать префикс длинных слов («три» внутри «тридцать»).
final String numExpr = grp(
    grp(grp('$tenWords${grp('[- ]$numAlt')}?') + '|$numAlt'));

class _Span {
  int index;
  String match;
  _Span(this.index, this.match);
}

class _PodSpan {
  final int index;
  final String match;
  final String value;
  _PodSpan(this.index, this.match, this.value);
}

/// Основной вход парсера. Порт parseReminder(phrase, baseDate).
ParseResult parseReminder(String phrase, [DateTime? baseArg]) {
  final base = baseArg ?? DateTime.now();
  if (phrase.trim().isEmpty) return const ParseResult();

  final original = phrase.replaceAll(RegExp(r'\s+'), ' ').trim();
  final s = normKey(original);
  final consumed = <_Span>[];

  // eat: первое совпадение (не global!) — как s.match(re) в JS.
  RegExpMatch? eat(RegExp re) {
    final m = re.firstMatch(s);
    if (m != null) consumed.add(_Span(m.start, m.group(0)!));
    return m;
  }

  int? dayOffset; // сдвиг в днях от base
  int? absY, absM, absD; // абсолютная дата
  int? hour;
  int minute = 0;
  String? pod; // часть суток
  var timeFound = false, dateFound = false;
  DateTime? relResult; // результат для «через N ...»

  // ---------- A. «через N минут/часов/дней/недель» ----------
  // Единица времени. Правая граница — положительный просмотр «пробел или конец»,
  // а НЕ (?!\p{Ll}): та требует, чтобы [а-яё]* остановился ровно перед пробелом,
  // и если слово длиннее основы («минуту»), совпадение ломается целиком.
  final unit =
      '(?:секунд$ru|минут$ru|час$ru|дн$ru|ден$ru|суток$ru|нед$ru|месяц$ru)'
      r'(?=\s|$)';

  // Считаем результат «через N <единица>» от base.
  DateTime relFrom(double n, String u) {
    final r = n.round();
    if (u.startsWith('секунд')) return base.add(Duration(seconds: r));
    if (u.startsWith('минут')) return base.add(Duration(minutes: r));
    if (u.startsWith('час')) return base.add(Duration(minutes: (n * 60).round()));
    if (RegExp(r'^(дн|ден|суток)').hasMatch(u)) {
      return base.add(Duration(days: r));
    }
    if (u.startsWith('нед')) return base.add(Duration(days: (n * 7).round()));
    // месяцы: арифметика как setMonth в JS
    final total = base.year * 12 + (base.month - 1) + r;
    final y = total ~/ 12, mo = total % 12 + 1;
    final lastDay = _daysInMonth(y, mo);
    return DateTime(y, mo, base.day > lastDay ? lastDay : base.day,
        base.hour, base.minute, base.second);
  }

  void applyRel(RegExpMatch m, String token) {
    // «полтора часа» = 90 минут: wordToNum это слово не знает.
    final n = wordToNum(token);
    relResult = relFrom(
        n ?? (RegExp(r'^полтор').hasMatch(token) ? 1.5 : 0), m.group(2)!);
    consumed.add(_Span(m.start, m.group(0)!));
  }

  // «полчаса» — отдельное слово, а не «<число> <единица>», поэтому проверяем отдельно.
  {
    final m = RegExp(w('через') + r'\s+полчаса' + wbR).firstMatch(s);
    if (m != null) {
      relResult = base.add(const Duration(minutes: 30));
      consumed.add(_Span(m.start, m.group(0)!));
    }
  }

  // «через час», «через минуту», «через неделю» — число не названо, значит один.
  if (relResult == null) {
    final m = RegExp(w('через') + r'\s+(' + unit + ')' + wbR).firstMatch(s);
    if (m != null) {
      relResult = relFrom(1, m.group(1)!);
      consumed.add(_Span(m.start, m.group(0)!));
    }
  }

  // «через два часа», «через двадцать пять минут», «через тридцать минут».
  // Число берём через NUM_EXPR, НО составные формы («двадцать пять») он
  // склеивает пробелом только если обе части внутри одного матча. RegExp в
  // Dart жадничает: альтернатива «(?:двадцать|…)(?:[- ]\d)?» матчит и голое
  // «двадцать», оставляя «пять» вне группы. Поэтому добавляем явный вариант
  // «<десяток> <число>» ПЕРЕД numExpr — иначе фраза не распознаётся целиком.
  if (relResult == null) {
    final m = RegExp(w('через') +
            r'\s+(полторы|полтора|' + numExpr + r')\s+(' + unit + ')' + wbR)
        .firstMatch(s);
    if (m != null) applyRel(m, m.group(1)!);
  }

  // ---------- B. Абсолютная дата и время ----------
  if (relResult == null) {
    // «послезавтра / завтра / сегодня / вчера»
    if (eat(RegExp(w('послезавтра'))) != null) {
      dayOffset = 2;
      dateFound = true;
    } else if (eat(RegExp(w('завтра'))) != null) {
      dayOffset = 1;
      dateFound = true;
    } else if (eat(RegExp(w('сегодня'))) != null) {
      dayOffset = 0;
      dateFound = true;
    } else if (eat(RegExp(w('вчера'))) != null) {
      dayOffset = -1;
      dateFound = true;
    }

    // день недели: «в пятницу», «в следующий вторник»
    if (dayOffset == null) {
      final m = eat(RegExp(
          r'(?:в\s+)?(?:следующ' + ru + r'\s+)?(' + joinKeys(weekdays) + ')' + wbR));
      if (m != null) {
        final target = weekdays[m.group(1)!]!;
        final jsDay = base.weekday % 7; // 0 = вс, как getDay()
        var diff = (target - jsDay + 7) % 7;
        if (diff == 0) diff = 7;
        dayOffset = diff;
        dateFound = true;
      }
    }

    // ---------- C. Время (раньше блока дат, чтобы «10 мая» не съелось как «в 10 … мая») ----------
    // Часть суток ищем заранее и НЕ потребляем: она либо войдёт в состав
    // выражения времени («в семь утра»), либо будет поглощена отдельно ниже.
    // Иначе два перекрывающихся совпадения рвут текст («в семь» + «утра» → «Ть а»).
    final podRe = RegExp(wbL + '(' + joinKeys(partsOfDay) + ')' + wbR);
    final podHit = podRe.firstMatch(s);
    final podSpan = podHit == null
        ? null
        : _PodSpan(
            podHit.start, podHit.group(0)!, partsOfDay[podHit.group(1)!]!);

    // Числовое: «15:30», «в 15.30» — предлог «в»/«у» забираем вместе со временем,
    // иначе он остаётся в тексте напоминания.
    {
      final m = eat(RegExp(r'(^|[^0-9.])(?:(?:в|у)\s+)?(\d{1,2}):(\d{2})(?![0-9])'));
      if (m != null) {
        final h = int.parse(m.group(2)!), mi = int.parse(m.group(3)!);
        if (h <= 23 && mi < 60) {
          hour = h;
          minute = mi;
          timeFound = true;
          consumed.last = _Span(m.start + m.group(1)!.length,
              m.group(0)!.substring(m.group(1)!.length));
        } else {
          // совпадение не признано временем — не вырезаем его из текста
          consumed.removeLast();
        }
      }
    }

    // «без четверти шесть», «без пятнадцати три»
    if (hour == null) {
      final m = eat(RegExp(w('без') +
          r'\s+(четвер' + ru + '|' + numExpr + r')(?:\s+минут)?\s+(час' + ru +
          '|' + joinKeys(numWords) + '|' + joinKeys(ordinals) + ')' + wbR));
      if (m != null) {
        final subTok = m.group(1)!;
        final sub = RegExp(r'^четвер').hasMatch(subTok) ? 15.0 : wordToNum(subTok);
        final hhTok = m.group(2)!;
        final hh = RegExp(r'^час').hasMatch(hhTok) ? 1.0 : wordToNum(hhTok);
        if (hh != null && sub != null && sub < 60) {
          hour = hh.toInt() - 1;
          minute = 60 - sub.toInt();
          timeFound = true;
        }
      }
    }

    // «половина шестого», «половине десятого», «половину седьмого» — любые падежи.
    if (hour == null) {
      final m = eat(RegExp(
          wbL + r'половин[а-яё]*\s+(' + joinKeys(ordinals) + ')' + wbR));
      if (m != null) {
        hour = ordinals[m.group(1)!]! - 1;
        minute = 30;
        timeFound = true;
      }
    }

    // «полшестого», «пол-шестого», «пол девятого»
    if (hour == null) {
      final m =
          eat(RegExp(wbL + r'пол[-\s]?(' + joinKeys(ordinals) + ')' + wbR));
      if (m != null) {
        hour = ordinals[m.group(1)!]! - 1;
        minute = 30;
        timeFound = true;
      }
    }

    // «в семь часов», «в 5», «в час», «где-то в десять».
    // Если сразу за числом стоит часть суток («в десять вечера», «в семь утра»),
    // поглощаем её здесь же: два перекрывающихся совпадения рвали текст
    // и теряли уточнение («вечера» игнорировалось → 10:00 вместо 22:00).
    if (hour == null) {
      final m = eat(RegExp(
          r'(?:где-то\s+в|примерно\s+в|около\s+в|в|у)\s+(' +
          numExpr + r'|час' + ru + r'|полтора)' + wbR +
          r'(?:\s+(?:час' + ru + r'|мин' + ru + '))?'
          r'(?:\s+((' + joinKeys(partsOfDay) + ')' + wbR + '))?'));
      if (m != null) {
        final t = m.group(1)!;
        int? h;
        if (t.startsWith('час')) {
          h = 1;
        } else if (t == 'полтора') {
          h = 1;
          minute = 30;
        } else {
          h = wordToNum(t)?.toInt();
        }
        if (h != null && h >= 0 && h <= 23) {
          hour = h;
          timeFound = true;
          if (m.group(2) != null) pod = partsOfDay[m.group(2)!];
        }
      }
    }

    // «в шесть с четвертью»
    if (hour != null && minute == 0) {
      if (eat(RegExp(r'с\s+четверть(?:ю)?' + wbR)) != null) minute = 15;
    }

    // часть суток: «утра», «вечером»… — поглощаем один раз.
    // Если её уже забрало выражение времени («в десять вечера»), не трогаем повторно.
    if (podSpan != null && pod == null) {
      pod = podSpan.value;
      consumed.add(_Span(podSpan.index, podSpan.match));
    }

    // полдень / полночь
    if (hour == null) {
      if (eat(RegExp('полдень' + wbR + '|полудня' + wbR)) != null) {
        hour = 12;
        timeFound = true;
      } else if (eat(RegExp('полночь' + wbR + '|полуночи' + wbR)) != null) {
        hour = 0;
        timeFound = true;
      }
    }

    // ---------- D. Дата (после времени) ----------
    // «15 октября», «5 мая 2027», «двадцать пятое октября»
    if (dayOffset == null && absY == null) {
      final m = eat(RegExp('(' + numExpr + r')(?:\s+(?:числа|го))?\s+(' +
          joinKeys(months) + ')' + wbR + r'(?:\s+(\d{4}))?'));
      if (m != null) {
        final day = wordToNum(m.group(1)!)?.toInt();
        final mon = months[m.group(2)!];
        if (day != null && day >= 1 && day <= 31 && mon != null) {
          var year = m.group(3) != null ? int.parse(m.group(3)!) : base.year;
          if (!_validDate(year, mon, day)) {
            return const ParseResult(error: 'Такой даты не существует');
          }
          // Дата без года, которая уже прошла в этом году → следующий год.
          // Сравнение на полудне, как probe/getMonth в JS-оригинале.
          if (m.group(3) == null &&
              !DateTime(year, mon + 1, day, 12)
                  .isAfter(DateTime(base.year, base.month, base.day, 12))) {
            year += 1;
          }
          absY = year;
          absM = mon;
          absD = day;
          dateFound = true;
        }
      }
    }

    // числовая дата: «15.10», «15/10/2026»
    if (dayOffset == null && absY == null) {
      final m = eat(RegExp(
          r'(^|[^0-9:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![0-9:])'));
      if (m != null) {
        var day = int.parse(m.group(2)!), mon = int.parse(m.group(3)!) - 1;
        if (mon < 0 || mon > 11) {
          final t = day;
          day = mon + 1;
          mon = t - 1;
        }
        if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
          final yTok = m.group(4);
          final year = yTok != null
              ? (yTok.length <= 2 ? 2000 + int.parse(yTok) : int.parse(yTok))
              : base.year;
          if (!_validDate(year, mon, day)) {
            return const ParseResult(error: 'Такой даты не существует');
          }
          absY = year;
          absM = mon;
          absD = day;
          dateFound = true;
          consumed.last = _Span(m.start + m.group(1)!.length,
              m.group(0)!.substring(m.group(1)!.length));
        }
      }
    }
  }

  // ---------- Сборка ----------
  late DateTime when;
  if (relResult != null) {
    when = relResult!;
    timeFound = true;
    dateFound = true;
  } else {
    when = absY != null
        ? DateTime(absY, absM! + 1, absD!)
        : dayOffset != null
            ? DateTime(base.year, base.month, base.day + dayOffset)
            : DateTime(base.year, base.month, base.day);

    if (hour != null) {
      var h = hour!;
      if (pod == 'morning') {
        if (h == 12) h = 0;
      } else if (pod == 'afternoon') {
        if (h >= 1 && h <= 5) h += 12;
      } else if (pod == 'evening') {
        if (h >= 1 && h <= 11) h += 12;
      } // 10 вечера → 22:00
      else if (pod == 'night') {
        if (h >= 8 && h <= 11) h += 12;
        if (h == 12) h = 0;
      }
      h = ((h % 24) + 24) % 24;
      when = DateTime(when.year, when.month, when.day, h, minute);
    } else if (pod != null) {
      when = DateTime(when.year, when.month, when.day, defaultHour[pod]!);
      timeFound = true;
    } else if (!dateFound) {
      // Ни времени, ни даты — предложим через час (приблизительно)
      return ParseResult(
        when: base.add(const Duration(hours: 1)),
        text: cap(cleanup(stripConsumed(original, consumed))) ?? 'Напоминание',
      );
    }

    // Перенос на завтра, если указан только день без времени и он уже «прошёл» (сегодня)
    if (!timeFound && dayOffset == 0 && !when.isAfter(base)) {
      when = DateTime(when.year, when.month, when.day + 1);
    }
    // Явная абсолютная дата («15 октября») не сдвигается из-за прошедшего часа.
    if (timeFound && absY == null && dayOffset == null && !when.isAfter(base)) {
      when = when.add(const Duration(days: 1));
    }
  }

  final text = cap(cleanup(stripConsumed(original, consumed))) ?? 'Напоминание';
  return ParseResult(
    when: when,
    text: text.isEmpty ? 'Напоминание' : text,
    timeFound: timeFound,
    dateFound: dateFound,
    approx: !timeFound,
  );
}

bool _validDate(int year, int mon0, int day) {
  if (year < 1 || mon0 < 0 || mon0 > 11 || day < 1) return false;
  return day <= _daysInMonth(year, mon0 + 1);
}

int _daysInMonth(int y, int m1) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m1 == 2 && (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0))) return 29;
  return lengths[m1 - 1];
}

String stripConsumed(String s, List<_Span> consumed) {
  var out = s;
  final ranges =
      consumed.map((x) => [x.index, x.index + x.match.length]).toList()
        ..sort((a, b) => a[0] - b[0]);
  final merged = <List<int>>[];
  for (final span in ranges) {
    if (merged.isNotEmpty && span[0] <= merged.last[1]) {
      if (span[1] > merged.last[1]) merged.last[1] = span[1];
    } else {
      merged.add([span[0], span[1]]);
    }
  }
  for (final m in merged.reversed.toList()) {
    out = '${out.substring(0, m[0])} ${out.substring(m[1])}';
  }
  return out.replaceAll(RegExp(r'\s+'), ' ').trim();
}

String cleanup(String text) {
  final weekdayAlt = joinKeys(weekdays);
  var t = text
      // Сначала убираем глагол («напомни», «напомнить»), чтобы слово даты
      // оказалось в начале строки и следующий шаг его увидел.
      .replaceAll(
          RegExp('напомин' + ru + '|напомн' + ru +
              '|напоминание|не забудь|помяни',
              caseSensitive: false),
          ' ')
      .replaceAll(
          RegExp('^\\s*(чтобы|про|насчёт|на счёт|о том что|что)\\s+',
              caseSensitive: false, unicode: true),
          '')
      .trim();
  // Дата и день недели уже показаны отдельно («Завтра 07:00 | …»),
  // поэтому в тексте действия ведущее слово даты избыточно.
  t = t.replaceAll(
      RegExp(
          '^\\s*в?\\s*(?:послезавтра|завтра|сегодня|вчера|(?:' +
              weekdayAlt + '))\\s+',
          caseSensitive: false,
          unicode: true),
      '');
  t = t.replaceAll(
      RegExp(w('мне') + '|' + w('нам') + '|' + w('меня'),
          caseSensitive: false, unicode: true),
      ' ');
  t = t.replaceAll(
      RegExp(w('пожалуйста'), caseSensitive: false, unicode: true), ' ');
  t = t.replaceAll(
      RegExp(
          w('где-то') + '|' + w('примерно') + '|' + w('приблизительно') +
              '|' + w('около'),
          caseSensitive: false,
          unicode: true),
      ' ');
  // Осиротевший предлог: выражение времени вырезано («… в половине десятого …»),
  // а «в» осталось висеть отдельным словом.
  t = t.replaceAll(RegExp('^\\s*в(\\s+|\$)', unicode: true), '');
  t = t.replaceAll(RegExp(r'\s+'), ' ');
  t = t.replaceAll(RegExp(r'^[\s,.:;-]+|[\s,.:;-]+$'), '').trim();
  return t;
}

String? cap(String? t) {
  if (t == null || t.isEmpty) return t;
  return t[0].toUpperCase() + t.substring(1);
}

/// Формат «Когда» для UI. Порт formatWhen().
String formatWhen(DateTime? d) {
  if (d == null) return '';
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const mons = [
    'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'
  ];
  final now = DateTime.now();
  bool sameDay(DateTime x, DateTime y) =>
      x.year == y.year && x.month == y.month && x.day == y.day;
  final hhmm =
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  if (sameDay(d, now)) return 'Сегодня $hhmm';
  if (sameDay(d, now.add(const Duration(days: 1)))) return 'Завтра $hhmm';
  if (sameDay(d, now.subtract(const Duration(days: 1)))) return 'Вчера $hhmm';
  return '${d.day} ${mons[d.month - 1]}, ${days[d.weekday % 7]} $hhmm';
}
