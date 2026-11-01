// lib/domain/time_parser.dart — «ИИ»-парсер русской речи о дате и времени.
//
// Портирует src/lib/timeParser.js (679 строк) из React-версии. Это самая
// ценная часть проекта: парсер понимает «завтра в 5», «через два часа»,
// «в пятницу вечером», «15 октября в 10 утра», «без четверти шесть»,
// «полшестого», «половина десятого».
//
// Полная таблица правил переносится на этапе 2; здесь ядро API и словарь,
// идентичный JS-версии по числам/дням недели/месяцам/частям суток.
// Тесты переносятся вместе с правилами (test/time_parser_test.dart).

class ParsedTime {
  final DateTime when;

  /// Что распознано — для подсветки в UI и отладки.
  final String matched;

  const ParsedTime(this.when, {this.matched = ''});
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

/// День недели: 0 = воскресенье (как в DateTime.weekday: 1..7 → приводим сами).
const Map<String, int> weekdays = {
  'понедельник': 1, 'понедельника': 1, 'понедельнику': 1,
  'вторник': 2, 'вторника': 2, 'вторнику': 2,
  'среда': 3, 'среду': 3, 'среды': 3,
  'четверг': 4, 'четверга': 4, 'четвергу': 4,
  'пятница': 5, 'пятницу': 5, 'пятницы': 5,
  'суббота': 6, 'субботу': 6, 'субботы': 6,
  'воскресенье': 7, 'воскресенья': 7, 'воскресенью': 7,
};

const Map<String, int> months = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
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

/// Нормализация: ё→е, нижний регистр — как toKey() в JS-версии.
String normKey(String s) => s.toLowerCase().replaceAll('ё', 'е');

/// Слово → число (цифры, слова, «двадцать пять»). Порт wordToNum().
int? wordToNum(String word) {
  if (RegExp(r'^\d+$').hasMatch(word)) return int.parse(word);
  final k = normKey(word);
  if (numWords.containsKey(k)) return numWords[k];
  if (ordinals.containsKey(k)) return ordinals[k];
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
  return val == 0 ? null : val;
}

/// Основной вход парсера. Реализация полных правил — этап 2 плана
/// (порт остальных ~560 строк timeParser.js + перенос тестов).
ParsedTime? parseRussianDateTime(String text, {DateTime? now}) {
  // TODO(этап 2): перенести правила из timeParser.js одно за другим,
  // после каждого правила запускать перенесённые тесты.
  throw UnimplementedError('Порт правил timeParser.js выполняется (этап 2)');
}
