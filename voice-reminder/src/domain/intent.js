import { parseReminder } from "../lib/timeParser.js";
import { WEEKDAYS_SRC } from "./time-lexicon.js";
import {
  defaultSchedule,
  localDate,
  nextOccurrences,
  pad,
  validateSchedule,
  PAST_TIME_MESSAGE,
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
// Числа словами для оборота «каждые два часа»: люди чаще говорят словом,
// чем цифрой. Значения берём только те, что встречаются в этом обороте.
const NUM_WORD_VALUES = {
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
  пятнадцать: 15,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
};
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
/**
 * Названия месяцев для подсчёта дат-кандидатов. Отдельный список нужен
 * потому, что в MONTHS основы записаны шаблоном («январ»), и собрать из них
 * проверку «слово целиком» нельзя: «ма[йяе]» — не слово, а выражение.
 */
const MONTHS_RU = [
  "января", "январь", "февраля", "февраль", "марта", "март",
  "апреля", "апрель", "мая", "май", "июня", "июнь", "июля", "июль",
  "августа", "август", "сентября", "сентябрь", "октября", "октябрь",
  "ноября", "ноябрь", "декабря", "декабрь",
];
/**
 * Порядковые числительные дня месяца: «двадцать пятого декабря» — это дата,
 * хотя дня здесь нет цифрой. Без них такая фраза не попадала в подсчёт.
 */
const ORDINAL_DAYS_SRC = [
  "первого", "второго", "третьего", "четвертого", "четвёртого", "пятого",
  "шестого", "седьмого", "восьмого", "девятого", "десятого",
  "одиннадцатого", "двенадцатого", "тринадцатого", "четырнадцатого",
  "пятнадцатого", "шестнадцатого", "семнадцатого", "восемнадцатого",
  "девятнадцатого", "двадцатого", "тридцатого",
  "двадцать первого", "двадцать второго", "двадцать третьего",
  "двадцать четвертого", "двадцать четвёртого", "двадцать пятого",
  "двадцать шестого", "двадцать седьмого", "двадцать восьмого",
  "двадцать девятого", "тридцать первого",
].join("|");
/**
 * Порог уверенности, ниже которого разбор переспрашивает.
 *
 * Не «ошибка», а «стоит уточнить»: напоминание с таким разбором сохраняется,
 * если человек подтвердит. Значение подобрано так, чтобы ОДИН вопрос по часу
 * (штраф 0.3) уже показывал переспрос: 1.0 − 0.3 = 0.7 < 0.75. Обычная фраза
 * с одной датой и временем сюда не попадает — у неё 1.0.
 */
export const CONFIDENCE_THRESHOLD = 0.75;

/** Сколько уверенности снимает один пункт сомнения. */
const CONFIDENCE_PENALTY = { hour: 0.3, dates: 0.3, issue: 0.4 };
/** Ниже этого значения не опускаемся: разбор всё ещё осмысленный. */
const CONFIDENCE_FLOOR = 0.1;

/**
 * Числовая уверенность разбора.
 *
 * Базовый скор 1.0; вычитается за каждый вопрос, который человеку придётся
 * решить: неоднозначный час, несколько дат, замечания по условиям.
 * Неуверенность не равна ошибке, поэтому пол не ноль: напоминание можно
 * сохранить, подтвердив.
 */
export function scoreConfidence({ issues = [], doubts = [], parsed = {} } = {}) {
  let score = 1 - issues.length * CONFIDENCE_PENALTY.issue;
  for (const d of doubts) score -= CONFIDENCE_PENALTY[d.kind] ?? 0.2;
  return Math.max(CONFIDENCE_FLOOR, Math.round(score * 100) / 100);
}

/**
 * Сколько разных дат-кандидатов названо во фразе.
 *
 * Нужно, чтобы отличить «завтра в 7» (одна дата) от «в пятницу и в субботу»
 * (две): во втором случае приложение обязано спросить, а не выбрать первую.
 * Считаются только явные обороты даты — «завтра», «послезавтра», «вчера»,
 * день недели, число с месяцем (словами или цифрами), числовая дата.
 */
export function countDateCandidates(phrase) {
  const p = String(phrase || "").toLowerCase().replaceAll("ё", "е");
  const monthAlt = "(?:" + MONTHS_RU.join("|") + ")";
  // День перед месяцем: цифрой, количественным числительным («двадцать
  // пять») или порядковым («двадцать пятого»). Необязателен: «в декабре»
  // тоже дата. Порядковые длиннее количественных, поэтому идут первыми.
  const dayAlt =
    "(?:" +
    ORDINAL_DAYS_SRC +
    "|(?:двадцать|тридцать)(?:\\s+(?:один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять))?" +
    "|\\d{1,2}|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять" +
    "|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать" +
    "|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать" +
    ")";
  const patterns = [
    /(?<!\p{L})послезавтра(?!\p{L})/gu,
    /(?<!\p{L})завтра(?!\p{L})/gu,
    /(?<!\p{L})сегодня(?!\p{L})/gu,
    /(?<!\p{L})вчера(?!\p{L})/gu,
    new RegExp(
      "(?<!\\p{L})(?:(?:в|во|на|по)\\s+)?(?:" + WEEKDAYS_SRC + ")(?!\\p{L})",
      "gu",
    ),
    new RegExp(
      "(?<!\\p{L})(?:" + dayAlt + "\\s+)?(?:числа\\s+)?(?:го\\s+)?" +
        monthAlt +
        "(?!\\p{L})",
      "gu",
    ),
    /(?<![\d.:])\d{1,2}[./](?:0[1-9]|1[0-2])(?![.\d])/gu,
  ];
  let total = 0;
  for (const re of patterns) total += (p.match(re) || []).length;
  return total;
}

export function parseIntent(phrase, now = new Date()) {
  const s = defaultSchedule(now),
    issues = [],
    // Что именно смущает в разборе. issues — то, что человек обязан
    // исправить, а doubts — то, где разбор формально прошёл, но значение
    // может быть другим, и об этом стоит спросить. Разделение нужно, чтобы
    // «полчетвёртого» не считалось ошибкой (оно сохраняется как есть), но
    // приложение всё равно показало дневное чтение и предложило выбор.
    doubts = [];
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
    // «каждые два часа» — число словом встречается чаще, чем цифрой.
    // Раньше такой оборот не разбирался: «два часа» оставалось в тексте, а
    // время подставлялось произвольное.
    const iv = remove(
      /каждые\s+(\d+|два|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|пятнадцать|двадцать|тридцать|сорок|пятьдесят)\s+(час[а-я]*|минут[а-я]*)/u,
    );
    if (iv) {
      const n = /^\d+$/.test(iv[1]) ? +iv[1] : NUM_WORD_VALUES[iv[1]];
      s.kind = "interval";
      s.intervalMinutes = n * (iv[2].startsWith("час") ? 60 : 1);
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
  const parsed = parseReminder(rest.replace(/\s+/g, " ").trim(), now);
  if (parsed.error) issues.push(parsed.error);
  if (!parsed.timeFound && s.kind !== "interval")
    issues.push("Уточните время напоминания");
  if (!recurring && parsed.when) {
    s.at = parsed.when.toISOString();
    // Одна формулировка на всё приложение.
    if (parsed.when <= now) issues.push(PAST_TIME_MESSAGE);
  }
  // Двусмысленный час: «в час» — это и 13:00, и 01:00, «полчетвёртого» — и
  // 15:30, и 03:30. Разбор формально прошёл, значение выбрано дневное, но
  // человеку стоит показать оба варианта и дать подтвердить.
  if (parsed.ambiguous && parsed.choices?.length)
    doubts.push({
      kind: "hour",
      choices: parsed.choices,
      chosen: parsed.choices[0],
    });
  // Несколько дат в одной фразе: каждую можно развести кнопкой «Добавить»,
  // но молча выбрать одну нельзя — напоминание уедет не туда.
  const dateCandidates = countDateCandidates(rest);
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
  if (dateCandidates > 1)
    doubts.push({ kind: "dates", count: dateCandidates, chosen: s.at || null });
  const confidence = scoreConfidence({ issues, doubts, parsed });
  return {
    text,
    schedule: s,
    originalTranscript: phrase,
    issues: [...new Set(issues)],
    // Числовая уверенность разбора: 1.0 — всё понятно без оговорок.
    // Сомнения вычитаются по шагу за пункт, но не до нуля: даже неуверенный
    // разбор сохраняем, а не выбрасываем — человеку проще поправить готовое.
    confidence,
    // Порог, ниже которого приложение переспрашивает. Значение вынесено
    // наружу, чтобы вызывающий код не повторял его у себя.
    needsConfirmation: confidence < CONFIDENCE_THRESHOLD,
    // Что именно стоит подтвердить: час дня/ночи разными вариантами и
    // несколько дат в одной фразе — два разных вопроса.
    doubts,
    // Совместимость с прежним значением: строковый признак, на который
    // опирались старые вызовы.
    legacy: issues.length ? "needsConfirmation" : "parsed",
  };
}
