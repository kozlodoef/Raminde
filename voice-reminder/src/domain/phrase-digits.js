// domain/phrase-digits.js — перевод даты и времени в расшифровке на цифры.
//
// Зачем. Пользователь диктует «напомни завтра в семь утра полить цветы», а в
// поле редактора хочется видеть «напомни 18.11 в 07:00 полить цветы»: цифры
// проверяются глазом быстрее, чем слова, и меньше шансов на опечатку.
//
// Модуль работает поверх уже разобранного результата: он НЕ разбирает фразу
// заново (этим занимается parseGroup), а заменяет в исходном тексте те
// участки, которые распознаватель уверенно определил как дату и время.
// Если что-то не распознано — текст остаётся как был, ничего не теряется.

const NUMBERS = {
  ноль: 0,
  один: 1,
  два: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
};

const MONTHS = {
  январь: 1, января: 1,
  февраль: 2, февраля: 2,
  март: 3, марта: 3,
  апрель: 4, апреля: 4,
  май: 5, мая: 5,
  июнь: 6, июня: 6,
  июль: 7, июля: 7,
  август: 8, августа: 8,
  сентябрь: 9, сентября: 9,
  октябрь: 10, октября: 10,
  ноябрь: 11, ноября: 11,
  декабрь: 12, декабря: 12,
};

const WEEKDAYS = {
  понедельник: 1, вторник: 2, среда: 3, среду: 3, четверг: 4,
  пятница: 5, пятницу: 5, суббота: 6, субботу: 6, воскресенье: 7,
};

// Порядковые числительные для оборота «четверть седьмого»: значение — это
// номер часа, к которому относится доля (седьмого = седьмой час = 6:15).
// Даны и родительный («седьмого»), и предложный («восьмом») падежи.
const ORDINAL_HOURS = {
  первого: 1, второго: 2, третьего: 3, четвертого: 4, четвёртого: 4,
  пятого: 5, шестого: 6, седьмого: 7, восьмого: 8, девятого: 9,
  десятого: 10, одиннадцатого: 11, двенадцатого: 12,
  первом: 1, втором: 2, третьем: 3, четвертом: 4, четвёртом: 4,
  пятом: 5, шестом: 6, седьмом: 7, восьмом: 8, девятом: 9,
  десятом: 10, одиннадцатом: 11, двенадцатом: 12,
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Склоняемое слово-число («двадцать» + «пять») → число. */
function wordToNumber(text) {
  const words = text.toLowerCase().replaceAll('ё', 'е').trim().split(/\s+/);
  if (words.length === 1) return NUMBERS[words[0]] ?? null;
  const first = NUMBERS[words[0]];
  const second = NUMBERS[words[1]];
  if (first === undefined || second === undefined) return null;
  return first + second;
}

/** «07:00» → «07:00», «7» → «07:00». */
function toClock(h, m = 0) {
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  return pad2(h) + ':' + pad2(m);
}

/** Дата из Date → «ДД.ММ» (год добавляется только если он не текущий). */
export function shortDate(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1)
    : pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/**
 * Заменяет в фразе словесные обозначения времени на цифры.
 *
 * @param {string} phrase  исходная расшифровка
 * @param {Array<{time:string, index:number, length:number}>} ranges
 *        найденные участки времени (из parseGroup)
 * @returns {string}
 */
export function digitsForTime(phrase, ranges = []) {
  if (!phrase || !ranges.length) return phrase;
  // Заменяем с конца, чтобы не сбить индексы предыдущих участков.
  const sorted = [...ranges].sort((a, b) => b.index - a.index);
  let out = phrase;
  for (const r of sorted) {
    if (!r?.time || typeof r.index !== 'number') continue;
    out = out.slice(0, r.index) + 'в ' + r.time + out.slice(r.index + r.length);
  }
  return out;
}

const NUMBER_WORD =
  '(?:двадцать|тридцать|сорок|пятьдесят)(?:\\s+(?:один|два|три|четыре|пять|шесть|семь|восемь|девять))?|' +
  Object.keys(NUMBERS).join('|');

/**
 * Переводит словесные дату и время в цифры.
 *
 * @param {string} phrase — расшифровка речи
 * @param {object} parsed — результат parseGroup (даёт schedule и даты)
 * @param {Date}   now
 * @returns {string} фраза с цифрами там, где разбор был уверенным
 */
export function toDigits(phrase, parsed, now = new Date()) {
  if (typeof phrase !== 'string' || !phrase) return phrase;
  let out = phrase;

  // --- 1. Время суток: «в семь утра» → «в 07:00» ---
  const timeRe = new RegExp(
    '(?<!\\p{L})в\\s+(' +
      NUMBER_WORD +
      ')(?:\\s+час(?:а|ов)?)?\\s*(утра|вечера|дня|ночи)?(?!\\p{L}|\\d)',
    'giu',
  );
  out = out.replace(timeRe, (full, num, marker) => {
    let h = wordToNumber(num);
    if (h === null) return full;
    const m = (marker || '').toLowerCase();
    if ((m === 'вечера' || m === 'дня') && h < 12) h += 12;
    if (m === 'ночи' && h === 12) h = 0;
    const clock = toClock(h, 0);
    return clock ? 'в ' + clock : full;
  });

  // --- 1б. Уже цифровое время с лишним словом суток: «в 10:00 утра» → «в 10:00» ---
  // Слово суток после цифр ни на что не влияет — час уже однозначен,
  // но в поле ввода оно мешает читать.
  out = out.replace(
    /(?<!\p{L})(в\s+\d{1,2}:\d{2})\s+(?:утра|вечера|дня|ночи)(?!\p{L})/giu,
    '$1',
  );

  // --- 1в. «без четверти шесть вечера» → точное время ---
  // Такие обороты разбирает timeParser, но в тексте они остаются словами.
  // Слово суток может идти после: «без четверти шесть вечера» = 17:45.
  out = out.replace(
    new RegExp(
      '(?<!\\p{L})(без\\s+четверти|без\\s+пятнадцати|без\\s+половины)\\s+(' + NUMBER_WORD + ')\\s*(утра|вечера|дня|ночи)?(?!\\p{L})',
      'giu',
    ),
    (full, phrase, numText, marker) => {
      const hStart = wordToNumber(numText);
      if (hStart === null) return full;
      const key = phrase.toLowerCase();
      const subtract = key.includes('четверти') ? 15 : key.includes('половины') ? 30 : 45;
      let hour = hStart - 1;
      if (hour < 0) hour += 24;
      let minutes = 60 - subtract;
      if (minutes >= 60) { minutes = 0; hour += 1; }
      const m = (marker || '').toLowerCase();
      if ((m === 'вечера' || m === 'дня') && hour < 12) hour += 12;
      if (m === 'ночи' && hour === 12) hour = 0;
      const clock = toClock(hour, minutes);
      return clock ? 'в ' + clock : full;
    },
  );
  // «четверть седьмого» = 6:15, «половина седьмого» = 6:30.
  // Порядковые числительные не делят корень с количественными
  // («семь» → «седьмого»), поэтому нужен отдельный словарь.
  // Признак суток идёт ПОСЛЕ оборота («половине восьмого вечера»), поэтому
  // захватываем его хвостом и применяем ту же поправку, что и для «в семь вечера».
  out = out.replace(
    /(?<!\p{L})(четверть|половина|половине)\s+([а-яё]+)\s*(утра|вечера|дня|ночи)?(?!\p{L})/giu,
    (full, kind, ordinalText, marker) => {
      const hour = ORDINAL_HOURS[ordinalText.toLowerCase().replaceAll('ё', 'е')];
      if (!hour) return full;
      const minutes = kind.toLowerCase().startsWith('четверть') ? 15 : 30;
      let h = hour - 1;
      const m = (marker || '').toLowerCase();
      if ((m === 'вечера' || m === 'дня') && h < 12) h += 12;
      if (m === 'ночи' && h === 12) h = 0;
      const clock = toClock(h, minutes);
      return clock ? 'в ' + clock : full;
    },
  );

  // --- 2. Цифровое время без минут: «в 15» → «в 15:00» ---
  // Заодно убираем слово суток: «в 10 утра» → «в 10:00», а не «в 10:00 утра».
  out = out.replace(
    /(?<!\p{L})в\s+(\d{1,2})(?![\d:.])\s*(?:утра|вечера|дня|ночи)?(?!\p{L})/giu,
    (full, h) => {
      const clock = toClock(Number(h), 0);
      return clock ? 'в ' + clock : full;
    },
  );

  // --- 3. Относительные дни: завтра / послезавтра / сегодня ---
  const dayWords = [
    { re: /(?<!\p{L})послезавтра(?!\p{L})/giu, shift: 2 },
    { re: /(?<!\p{L})завтра(?!\p{L})/giu, shift: 1 },
    { re: /(?<!\p{L})сегодня(?!\p{L})/giu, shift: 0 },
  ];
  for (const { re, shift } of dayWords) {
    out = out.replace(re, () => {
      const d = new Date(now);
      d.setDate(d.getDate() + shift);
      return shortDate(d, now) || '';
    });
  }

  // --- 4. «20 ноября» → «20.11» ---
  const dayMonthRe = new RegExp(
    '(?<!\\p{L})(\\d{1,2}|' + NUMBER_WORD + ')\\s+(' + Object.keys(MONTHS).join('|') + ')(?!\\p{L})',
    'giu',
  );
  out = out.replace(dayMonthRe, (full, dayText, monthText) => {
    const day = /^\d+$/.test(dayText) ? Number(dayText) : wordToNumber(dayText);
    const month = MONTHS[monthText.toLowerCase().replaceAll('ё', 'е')];
    if (!day || !month || day > 31) return full;
    return pad2(day) + '.' + pad2(month);
  });

  // --- 5. Дни недели: «в пятницу» → «пятница 20.11» ---
  const weekdayRe = new RegExp(
    '(?<!\\p{L})(?:в\\s+)?(' + Object.keys(WEEKDAYS).join('|') + ')(?!\\p{L})',
    'giu',
  );
  out = out.replace(weekdayRe, (full, name) => {
    const target = WEEKDAYS[name.toLowerCase().replaceAll('ё', 'е')];
    if (!target) return full;
    // Ближайший такой день недели, включая сегодняшний.
    const d = new Date(now);
    const current = d.getDay() === 0 ? 7 : d.getDay();
    let diff = target - current;
    if (diff < 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return shortDate(d, now) || full;
  });

  // --- 6. «через два часа» → «через 2 ч», «через полчаса» → «через 30 мин» ---
  out = out.replace(
    /(?<!\p{L})через\s+(полчаса|полтора\s+часа|(\d+)\s*час(?:а|ов)?)(?!\p{L})/giu,
    (full, whole, num) => {
      const key = whole.toLowerCase().replaceAll('ё', 'е');
      if (key === 'полчаса') return 'через 30 мин';
      if (key.startsWith('полтора')) return 'через 90 мин';
      return num ? `через ${num} ч` : full;
    },
  );
  out = out.replace(
    new RegExp(
      '(?<!\\p{L})через\\s+(' + NUMBER_WORD + ')\\s*(час(?:а|ов)?|минут(?:у|ы)?)(?!\\p{L})',
      'giu',
    ),
    (full, numText, unit) => {
      const n = wordToNumber(numText);
      if (n === null) return full;
      return `через ${n} ${unit.toLowerCase().startsWith('час') ? 'ч' : 'мин'}`;
    },
  );

  // Убираем задвоенный предлог: «в четверть седьмого» → замена дала «в в 06:15».
  out = out.replace(/(?<!\p{L})в\s+в\s+(?=\d)/giu, 'в ');

  // Схлопываем возможные двойные пробелы после замен.
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
