// domain/dates-spoken.js — разбор дат, произнесённых словами.
//
// Зачем отдельный модуль. parseGroup распознаёт «завтра», «в пятницу» и
// «25 декабря», но НЕ понимает порядковые числительные: «двадцать пятого
// декабря», «первого сентября». Именно так люди и говорят вслух — а фраза
// уходила целиком в текст напоминания, и оно срабатывало сегодня.
//
// Здесь только даты: день месяца (количественный и порядковый), месяц,
// необязательный год. Время разбирает parseGroup.
//
// Правило: если фраза содержит явную дату — используем её. Если дата в
// прошлом, берём следующий такой же день (человек говорит о будущем:
// «первого сентября» в ноябре значит следующее 1 сентября).

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

// Порядковые числительные дня месяца. Люди говорят «первого», «второго»,
// «двадцать пятого» — это родительный падеж, а не количественное «один».
const ORDINAL_DAYS = {
  первое: 1, первого: 1,
  второе: 2, второго: 2,
  третье: 3, третьего: 3,
  четвертое: 4, четвертого: 4, четвёртое: 4, четвёртого: 4,
  пятое: 5, пятого: 5,
  шестое: 6, шестого: 6,
  седьмое: 7, седьмого: 7,
  восьмое: 8, восьмого: 8,
  девятое: 9, девятого: 9,
  десятое: 10, десятого: 10,
  одиннадцатое: 11, одиннадцатого: 11,
  двенадцатое: 12, двенадцатого: 12,
  тринадцатое: 13, тринадцатого: 13,
  четырнадцатое: 14, четырнадцатого: 14,
  пятнадцатое: 15, пятнадцатого: 15,
  шестнадцатое: 16, шестнадцатого: 16,
  семнадцатое: 17, семнадцатого: 17,
  восемнадцатое: 18, восемнадцатого: 18,
  девятнадцатое: 19, девятнадцатого: 19,
  двадцатое: 20, двадцатого: 20,
  тридцатое: 30, тридцатого: 30,
  'двадцать первое': 21, 'двадцать первого': 21,
  'двадцать второе': 22, 'двадцать второго': 22,
  'двадцать третье': 23, 'двадцать третьего': 23,
  'двадцать четвертое': 24, 'двадцать четвертого': 24,
  'двадцать четвёртое': 24, 'двадцать четвёртого': 24,
  'двадцать пятое': 25, 'двадцать пятого': 25,
  'двадцать шестое': 26, 'двадцать шестого': 26,
  'двадцать седьмое': 27, 'двадцать седьмого': 27,
  'двадцать восьмое': 28, 'двадцать восьмого': 28,
  'двадцать девятое': 29, 'двадцать девятого': 29,
  'тридцать первое': 31, 'тридцать первого': 31,
};

const CARDINAL = {
  один: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7,
  восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
  тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20,
  тридцать: 31,
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Локальная дата в виде «2026-12-25». */
export function isoDate(d) {
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  );
}

/**
 * Находит в фразе дату, произнесённую словами или цифрами.
 *
 * @param {string} phrase
 * @param {Date} now — относительно чего считаем «в прошлом»
 * @returns {{date: string, match: string, day: number, month: number} | null}
 */
export function spokenDate(phrase, now = new Date()) {
  if (typeof phrase !== 'string' || !phrase.trim()) return null;
  const text = phrase.toLowerCase().replaceAll('ё', 'е');

  const monthAlt = Object.keys(MONTHS).join('|');

  // Составные и одиночные порядковые проверяем от длинных к коротким,
  // иначе «двадцать» перехватит «двадцать пятого».
  const ordAlt = Object.keys(ORDINAL_DAYS)
    .sort((a, b) => b.length - a.length)
    .join('|');

  // 1. Порядковое + месяц: «двадцать пятого декабря».
  let re = new RegExp(
    '(?<!\\p{L})(' + ordAlt + ')\\s+(' + monthAlt + ')(?:\\s+(\\d{4}))?(?!\\p{L})',
    'iu',
  );
  let m = re.exec(text);
  if (m) {
    const day = ORDINAL_DAYS[m[1]];
    const month = MONTHS[m[2]];
    const year = m[3] ? Number(m[3]) : null;
    return build(day, month, year, m[0], now);
  }

  // 2. Количественное + месяц: «двадцать пять декабря», «25 декабря».
  const cardAlt = Object.keys(CARDINAL)
    .sort((a, b) => b.length - a.length)
    .join('|');
  re = new RegExp(
    '(?<!\\p{L})(\\d{1,2}|' + cardAlt + ')\\s+(' + monthAlt + ')(?:\\s+(\\d{4}))?(?!\\p{L})',
    'iu',
  );
  m = re.exec(text);
  if (m) {
    const raw = m[1];
    const day = /^\d+$/.test(raw) ? Number(raw) : CARDINAL[raw];
    const month = MONTHS[m[2]];
    const year = m[3] ? Number(m[3]) : null;
    return build(day, month, year, m[0], now);
  }

  // 3. Числовая дата: «25.12», «25.12.2026».
  re = /(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?!\d)/u;
  m = re.exec(text);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = m[3] ? Number(m[3]) : null;
    return build(day, month, year, m[0], now);
  }

  // 4. День месяца без месяца: «двадцать пятого» — берём ближайший такой
  // день, если он ещё впереди, иначе следующий месяц.
  re = new RegExp(
    '(?<!\\p{L})(' +
      Object.keys(ORDINAL_DAYS).sort((a, b) => b.length - a.length).join('|') +
      ')(?!\\p{L})',
    'iu',
  );
  m = re.exec(text);
  if (m) {
    const day = ORDINAL_DAYS[m[1]];
    if (day >= 1 && day <= 31) {
      const base = new Date(now.getFullYear(), now.getMonth(), day);
      if (day < now.getDate()) base.setMonth(base.getMonth() + 1);
      if (base.getDate() !== day) base.setDate(0); // 31-е в коротком месяце
      return { date: isoDate(base), match: m[0], day, month: base.getMonth() + 1 };
    }
  }

  return null;
}

/**
 * Собирает дату. Если она уже прошла — берёт следующую (человек говорит
 * о будущем: «первого сентября» в ноябре = 1 сентября следующего года).
 */
function build(day, month, year, match, now) {
  if (!day || !month || day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  let d;
  if (year) {
    d = new Date(year, month - 1, day);
  } else {
    d = new Date(now.getFullYear(), month - 1, day);
    if (d.getDate() !== day) return null; // 30 февраля и подобное
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d < today) d.setFullYear(d.getFullYear() + 1);
  }
  return { date: isoDate(d), match, day: d.getDate(), month: d.getMonth() + 1 };
}

/** Убирает найденную дату из текста напоминания. */
export function stripDate(phrase, match) {
  if (!phrase || !match) return phrase;
  const re = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
  return phrase
    .replace(re, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}