import { parseReminder } from "../lib/timeParser.js";
import {
  defaultSchedule,
  localDate,
  nextOccurrences,
  pad,
  validateSchedule,
} from "./calendar.js";
const DAYS = [
  [/понедельник[а-я]*/u, 1],
  [/вторник[а-я]*/u, 2],
  [/сред(?:а|у|ы|ам|ам[и]?)/u, 3],
  [/четверг[а-я]*/u, 4],
  [/пятниц[а-я]*/u, 5],
  [/суббот[а-я]*/u, 6],
  [/воскресень[а-я]*/u, 7],
];
const MONTHS = [
  "январ",
  "феврал",
  "март",
  "апрел",
  "ма[йяе]",
  "июн",
  "июл",
  "август",
  "сентябр",
  "октябр",
  "ноябр",
  "декабр",
];
const MONTH_WORDS = [
  ["январ", 1],
  ["феврал", 2],
  ["март", 3],
  ["апрел", 4],
  ["ма[йяе]", 5],
  ["июн", 6],
  ["июл", 7],
  ["август", 8],
  ["сентябр", 9],
  ["октябр", 10],
  ["ноябр", 11],
  ["декабр", 12],
];

function monthPattern() {
  return MONTH_WORDS.map(([word]) => word).join("|");
}

function makeSpecificDate(year, month, day, now) {
  const explicitYear = year != null;
  year ??= now.getFullYear();
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
  if (!explicitYear) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    if (date < today) {
      date.setFullYear(year + 1);
      if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    }
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthNumber(word) {
  const index = MONTH_WORDS.findIndex(([pattern]) =>
    new RegExp(`^${pattern}`, "iu").test(word),
  );
  return index < 0 ? 0 : MONTH_WORDS[index][1];
}

// Extract two or more explicitly named dates without turning them into a
// long materialized series. The returned replacement leaves the time/action
// for the normal parser and stores only the finite date set in the rule.
function extractSpecificDates(phrase, now) {
  const source = String(phrase || "").toLowerCase().replaceAll("ё", "е");
  const spans = [];
  const dates = [];
  const add = (start, end, day, monthWord, year) => {
    const month = monthNumber(monthWord);
    if (!month || day < 1 || day > 31) return;
    const iso = makeSpecificDate(year, month, day, now);
    dates.push(iso);
  };
  const month = monthPattern();
  const grouped = new RegExp(
    `(?<!\\d)((?:\\d{1,2}(?:-?го)?\\s*(?:,|и)\\s*)+\\d{1,2}(?:-?го)?)\\s+(${month})(?:[а-яё]*)?(?:\\s+(\\d{4}))?`,
    "giu",
  );
  for (const match of source.matchAll(grouped)) {
    const numbers = [...match[1].matchAll(/\d{1,2}/g)].map((m) => +m[0]);
    const monthWord = match[2];
    const year = match[3] ? +match[3] : null;
    for (const day of numbers) add(match.index, match.index + match[0].length, day, monthWord, year);
    spans.push([match.index, match.index + match[0].length]);
  }
  const named = new RegExp(
    `(\\d{1,2})(?:-?го)?\\s+(${month})(?:[а-яё]*)?(?:\\s+(\\d{4}))?`,
    "giu",
  );
  for (const match of source.matchAll(named)) {
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some(([a, b]) => start >= a && end <= b)) continue;
    add(start, end, +match[1], match[2], match[3] ? +match[3] : null);
  }
  const numeric = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/giu;
  for (const match of source.matchAll(numeric)) {
    const start = match.index;
    const end = start + match[0].length;
    const year = match[3]
      ? (+match[3] < 100 ? 2000 + +match[3] : +match[3])
      : null;
    const date = makeSpecificDate(year, +match[2], +match[1], now);
    dates.push(date);
    spans.push([start, end]);
  }
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (dates.length < 2) return null;
  let cleaned = source;
  for (const match of source.matchAll(named)) {
    const start = match.index, end = start + match[0].length;
    if (!spans.some(([a, b]) => start >= a && end <= b)) spans.push([start, end]);
  }
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0]))
    cleaned = cleaned.slice(0, start) + " " + cleaned.slice(end);
  cleaned = cleaned.replace(/(?:\s|,)+(?:и(?:\s|,)+)?(?=(?:в|у)\s)/giu, " ");
  return { dates: unique, cleaned, invalid: dates.some((d) => !d) };
}

export function parseIntent(phrase, now = new Date()) {
  const s = defaultSchedule(now),
    issues = [];
  let rest = phrase.toLowerCase().replaceAll("ё", "е").trim();
  const recurring =
    /кажд|ежеднев|еженедел|ежемесяч|ежегод|по\s+(?:понедель|вторник|сред|четвер|пятниц|суббот|воскрес|четн|нечетн|будн|выходн)|раз\s+в/u.test(
      rest,
    );
  const remove = (re) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(re, " ");
    return m;
  };
  if (recurring) {
    s.kind = "calendar";
    s.frequency = "daily";
    const except = remove(
      /(?:кроме|за исключением)\s+([^,;]+?)(?=\s+в\s+\d|\s+в\s+[а-я]+\s+(?:утра|вечера)|[,;]|$)/u,
    );
    if (except) {
      for (const [re, n] of DAYS)
        if (re.test(except[1])) s.excludedWeekdays.push(n);
      const dates = except[1].match(/\d{4}-\d{2}-\d{2}/g);
      if (dates) s.excludedDates = dates;
      if (!s.excludedWeekdays.length && !dates)
        issues.push("Уточните исключения в редакторе");
    }
    for (const [re, n] of DAYS) {
      if (re.test(rest)) {
        s.weekdays.push(n);
        rest = rest.replace(
          new RegExp(
            "(?:только\\s+)?(?:кажд[а-я]*\\s+|по\\s+|в\\s+)?" + re.source,
            "gu",
          ),
          " ",
        );
      }
    }
    if (s.weekdays.length) s.frequency = "weekly";
    if (remove(/по\s+будням|кажд[а-я]*\s+будн[а-я]*/u)) {
      s.weekdays = [1, 2, 3, 4, 5];
      s.frequency = "weekly";
    }
    if (remove(/по\s+выходным/u)) {
      s.weekdays = [6, 7];
      s.frequency = "weekly";
    }
    if (remove(/(?:по\s+)?нечетн[а-я]*\s+(?:дням|числам|дня|числа)/u))
      s.dayParity = "odd";
    else if (remove(/(?:по\s+)?четн[а-я]*\s+(?:дням|числам|дня|числа)/u))
      s.dayParity = "even";
    const md = remove(
      /(?:каждого|кажд[а-я]*|только|по)\s+((?:\d{1,2}(?:-?(?:го|е|й))?(?:\s*(?:,|и)\s*)?)+)\s*(?:числа|числам|число)/u,
    );
    if (md) {
      s.monthDays = (md[1].match(/\d+/g) || []).map(Number);
      s.frequency = "monthly";
    }
    if (remove(/(?:ежегодно|каждый\s+год)/u)) s.frequency = "yearly";
    for (let i = 0; i < MONTHS.length; i++) {
      const re = new RegExp("(?:в\\s+)?" + MONTHS[i] + "[а-я]*", "u");
      if (re.test(rest)) {
        s.months.push(i + 1);
        rest = rest.replace(re, " ");
      }
    }
    if (s.frequency === "yearly" && !s.monthDays.length) {
      const m = remove(/(?:^|\s)(\d{1,2})(?:-?го)?(?=\s)/u);
      if (m) s.monthDays = [+m[1]];
    }
    if (remove(/последн[а-я]*\s+день\s+месяца/u)) {
      s.lastDay = true;
      s.frequency = "monthly";
      s.monthDays = [];
    }
    const ordinal = remove(
      /(?:перв[а-я]*|втор[а-я]*|трет[а-я]*|четверт[а-я]*|пят[а-я]*|последн[а-я]*)/u,
    );
    if (ordinal && s.weekdays.length) {
      s.ordinal = /последн/.test(ordinal[0])
        ? -1
        : /перв/.test(ordinal[0])
          ? 1
          : /втор/.test(ordinal[0])
            ? 2
            : /трет/.test(ordinal[0])
              ? 3
              : /четверт/.test(ordinal[0])
                ? 4
                : 5;
      s.weekday = s.weekdays[0];
      s.weekdays = [];
      s.frequency = "monthly";
    }
    const step = remove(
      /(?:раз\s+в|каждые)\s+(\d+)\s+(дн[а-я]*|недел[а-я]*|месяц[а-я]*|лет|год[а-я]*)/u,
    );
    if (step) {
      s.interval = +step[1];
      s.frequency = /дн/.test(step[2])
        ? "daily"
        : /недел/.test(step[2])
          ? "weekly"
          : /месяц/.test(step[2])
            ? "monthly"
            : "yearly";
    }
    const iv = remove(/каждые\s+(\d+)\s+(час[а-я]*|минут[а-я]*)/u);
    if (iv) {
      s.kind = "interval";
      s.intervalMinutes = +iv[1] * (iv[2].startsWith("час") ? 60 : 1);
      s.startAt = now.toISOString();
      const win = remove(
        /с\s+(\d{1,2}(?::\d{2})?)\s+до\s+(\d{1,2}(?::\d{2})?)/u,
      );
      if (win) {
        s.windowStart = win[1].includes(":") ? win[1] : pad(win[1]) + ":00";
        s.windowEnd = win[2].includes(":") ? win[2] : pad(win[2]) + ":00";
      }
    }
    const count = remove(/(\d+)\s+раз(?:а)?(?=\s|$)/u);
    if (count) s.count = +count[1];
    const until = remove(/до\s+(\d{4}-\d{2}-\d{2})/u);
    if (until) s.until = until[1];
    rest = rest.replace(
      /каждый день|кажд[а-я]*\s+(?:месяц[а-я]*|недел[а-я]*)|ежедневно|ежемесячно|еженедельно|только|кажд[а-я]*/gu,
      " ",
    );
  }
  const multiple = rest.match(
    /в\s+((?:\d{1,2}(?::\d{2})?(?:\s*(?:,|и)\s*)?){2,})/u,
  );
  if (multiple && recurring) {
    s.times = (multiple[1].match(/\d{1,2}(?::\d{2})?/g) || []).map((t) =>
      t.includes(":") ? t : pad(t) + ":00",
    );
    rest = rest.replace(multiple[0], `в ${s.times[0]}`);
  }
  const specific = !recurring ? extractSpecificDates(phrase, now) : null;
  const parsed = parseReminder(
    (specific?.cleaned || rest).replace(/\s+/g, " ").trim(),
    now,
  );
  if (parsed.error) issues.push(parsed.error);
  if (!parsed.timeFound && s.kind !== "interval")
    issues.push("Уточните время напоминания");
  if (specific) {
    s.kind = "calendar";
    s.frequency = "daily";
    s.anchorDate = specific.dates[0] || localDate(now);
    s.specificDates = specific.dates;
    if (specific.invalid) issues.push("В списке есть несуществующая дата — исправьте даты");
    if (parsed.timeFound)
      s.times = [`${pad(parsed.when.getHours())}:${pad(parsed.when.getMinutes())}`];
  } else if (!recurring && parsed.when) {
    s.at = parsed.when.toISOString();
    if (parsed.when <= now)
      issues.push("Указанное время уже прошло — выберите новую дату");
  }
  if (recurring && parsed.when && !multiple)
    s.times = [
      `${pad(parsed.when.getHours())}:${pad(parsed.when.getMinutes())}`,
    ];
  if (s.frequency === "weekly" && !s.weekdays.length)
    issues.push("Выберите дни недели");
  let text = parsed.text || "";
  if (text === "Напоминание") text = "";
  text = text.replace(/^(?:и|по|в)\s+/iu, "").trim();
  let cursor = 0;
  text = text.replace(/[\p{L}\p{N}-]+/gu, (word) => {
    const escaped = word
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/е/g, "[её]");
    const re = new RegExp("(?<!\\p{L})" + escaped + "(?!\\p{L})", "giu");
    re.lastIndex = cursor;
    const m = re.exec(phrase);
    if (!m) return word;
    cursor = m.index + m[0].length;
    return m[0];
  });
  if (text) text = text[0].toUpperCase() + text.slice(1);
  if (!text) issues.push("Добавьте, о чём напомнить");
  const validation = validateSchedule(s);
  issues.push(...validation);
  if (!issues.length && !nextOccurrences(s, now.getTime(), 1).length)
    issues.push("Условия не дают будущих дат");
  return {
    text,
    schedule: s,
    originalTranscript: phrase,
    issues: [...new Set(issues)],
    confidence: issues.length ? "needsConfirmation" : "parsed",
  };
}

// Separate independent reminders only when the second clause starts with an
// explicit time/date marker. This keeps "каждый день в 8 и 20" as one rule.
export function splitIntentPhrases(phrase) {
  const source = String(phrase || "").trim();
  if (!source) return [];
  const recurring =
    /кажд|ежеднев|еженедел|ежемесяч|ежегод|по\s+(?:понедель|вторник|сред|четвер|пятниц|суббот|воскрес|будн|выходн)/iu.test(
      source,
    );
  const marker = recurring
    ? "(?:сегодня|завтра|послезавтра|через\\s+\\d+|кажд[а-я]*|ежеднев[а-я]*|еженедел[а-я]*|ежемесяч[а-я]*|ежегод[а-я]*|по\\s+(?:понедельник[а-я]*|вторник[а-я]*|сред[а-я]*|четверг[а-я]*|пятниц[а-я]*|суббот[а-я]*|воскресень[а-я]*|будн[а-я]*|выходн[а-я]*))"
    : "(?:сегодня|завтра|послезавтра|через\\s+\\d+|в\\s+(?:понедельник[а-я]*|вторник[а-я]*|сред[а-я]*|четверг[а-я]*|пятниц[а-я]*|суббот[а-я]*|воскресень[а-я]*|\\d{1,2}(?::\\d{2})?(?:\\s+(?:утра|дня|вечера|ночи))?))";
  const boundary = new RegExp(`\\s+(?:и|а)\\s+(?=(?:напомни(?:те)?\\s+)?${marker})`, "giu");
  return source.split(boundary).map((part) => part.trim()).filter(Boolean);
}

export function parseIntents(phrase, now = new Date()) {
  return splitIntentPhrases(phrase).map((part) => parseIntent(part, now));
}
