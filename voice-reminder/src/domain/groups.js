import {
  defaultSchedule,
  localDate,
  nextOccurrences,
  shortTime,
  zonedTime,
  dateEpoch,
  zone,
  pad,
} from "./calendar.js";
import { parseIntent } from "./intent.js";
export const COLORS = [
  "#146ad4",
  "#7854b9",
  "#b55c24",
  "#19815d",
  "#b83d65",
  "#467487",
  "#c48216",
  "#a643b0",
  "#008b8b",
  "#ca493b",
  "#597b26",
  "#3754ac",
  "#975b42",
  "#ca5c86",
  "#246447",
  "#816d20",
  "#735aa8",
  "#267699",
  "#9e3b42",
  "#4d854a",
  "#a96919",
  "#755b73",
  "#36866f",
  "#9f537c",
];
export function colorFor(rule, index = 0) {
  return rule.color || COLORS[index % COLORS.length];
}
const numbers = {
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
const numSource =
  "(?:\\d{1,2}(?::\\d{2})?|(?:двадцать|тридцать|сорок|пятьдесят)(?:\\s+(?:один|два|три|четыре|пять|шесть|семь|восемь|девять))?|" +
  Object.keys(numbers).join("|") +
  ")";
// Названия частей дня, которые люди произносят вместо часа: «напомни в
// обед». Без них время не распознавалось, «обед» попадал в текст
// напоминания, а время оставалось пустым.
const DAYPARTS = { обед: "13:00", полдень: "12:00", полночь: "00:00" };
const daypartSource = Object.keys(DAYPARTS).join("|");
const term =
  "(?:" +
  daypartSource +
  "|" +
  numSource +
  "(?:\\s+час(?:а|ов)?)?" +
  "(?:\\s+" +
  numSource +
  "\\s+минут[а-яё]*)?" +
  "(?:\\s+(?:утра|вечера|дня|ночи))?" +
  ")";
const timeClause = new RegExp(
  "(?<!\\p{L})в\\s+(" +
    term +
    "(?:\\s*(?:,|и)\\s*(?:в\\s+)?" +
    term +
    ")*)(?!\\p{L}|\\d)",
  "giu",
);
// Время часто называют без предлога: «восемнадцать часов полить цветы».
// Раньше такое время не находилось, слово «часов» попадало в текст, а
// напоминание переспрашивало «Во сколько?».
//
// Берём только оборот с явным словом «час»: без него под правило попадали бы
// любые числа («купить 2 хлеба» превратилось бы в напоминание на 02:00).
const hourClause = new RegExp(
  "(?<!\\p{L})(" +
    numSource +
    "\\s+час(?:а|ов)?" +
    "(?:\\s+" +
    numSource +
    "\\s+минут[а-яё]*)?" +
    "(?:\\s+(?:утра|вечера|дня|ночи))?" +
    ")(?!\\p{L}|\\d)",
  "giu",
);
// «через два часа» и «каждые два часа» — это не время суток, а отсчёт или
// повтор. Их разбирает parseIntent, поэтому здесь такие обороты пропускаем.
// Окончание задаём явным классом: \w в JavaScript не включает кириллицу,
// и «кажд\w*» не поймало бы «каждые».
const countingBefore = /(?:через|кажд[а-яё]*|раз\s+в)\s*$/iu;
/**
 * Убирает из фразы названную словами дату.
 *
 * Нужно для бесплатной версии: там распознаются только время и событие, а
 * дату человек отмечает на календаре. Без вырезания слова «завтра» и
 * «двадцать пятого декабря» попадали бы в текст напоминания — получалось бы
 * «Завтра полить цветы» вместо «Полить цветы».
 */
export function dropDateWords(phrase) {
  const months =
    "январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр";
  // Границы слов задаём просмотром, а не \b: в JavaScript \b не считает
  // кириллицу буквами, и «завтра» им не ловится вовсе.
  const LB = "(?<!\\p{L})";
  const RB = "(?!\\p{L})";
  return phrase
    .replace(
      // «двадцать пятого декабря», «25 декабря», «5 мая 2027»
      new RegExp(
        "(?:\\d{1,2}|(?:двадцать|тридцать)\\s+)?(?:[а-яё]+\\s+)?(?:" +
          months +
          ")[а-яё]*(?:\\s+\\d{4})?",
        "giu",
      ),
      " ",
    )
    .replace(
      // «25.12», «25/12/2026»
      new RegExp("(?<![\\d./])\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?(?![\\d./])", "gu"),
      " ",
    )
    .replace(
      // «в пятницу», «следующий вторник», «по средам»
      new RegExp(
        LB +
          "(?:(?:в|во|по|на)\\s+)?(?:следующ[а-яё]*\\s+)?(?:понедельник|вторник|сред[а-яё]*|четверг|пятниц[а-яё]*|суббот[а-яё]*|воскресень[а-яё]*)[а-яё]*" +
          RB,
        "giu",
      ),
      " ",
    )
    .replace(
      // «сегодня», «завтра», «послезавтра», «вчера»
      new RegExp(LB + "(?:в\\s+)?(?:сегодня|завтра|послезавтра|вчера)" + RB, "giu"),
      " ",
    )
    .replace(
      // «через два дня», «через неделю» — это дата, а не время суток
      new RegExp(
        LB +
          "через\\s+(?:\\d+|полтора|полторы|[а-яё]+)(?:\\s+[а-яё]+)?\\s*(?:дн[а-яё]*|ден[а-яё]*|суток|недел[а-яё]*|месяц[а-яё]*|год[а-яё]*)" +
          RB,
        "giu",
      ),
      " ",
    )
    // Предлог «в» перед временем не трогаем: он принадлежит времени
    // («в 07:00 полить цветы»), а не убранной дате.
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
}
/**
 * Какое слово даты прозвучало: «сегодня», «завтра», «послезавтра».
 *
 * В бесплатной версии «завтра» и «послезавтра» не распознаются — день
 * выбирается на календаре. Но знать, что человек их произнёс, нужно: иначе
 * он решит, что напоминание встало на завтра, а оно молча встанет на
 * сегодня. Возвращаем слово, чтобы показать это в сообщении.
 */
export function spokenDateKind(phrase) {
  const p = String(phrase || "")
    .toLowerCase()
    .replaceAll("ё", "е");
  if (!p) return null;
  // Границы слов задаём просмотром: \b не считает кириллицу буквами.
  // «послезавтра» проверяем раньше «завтра», иначе короткое слово
  // совпало бы внутри длинного.
  if (/(?<!\p{L})послезавтра(?!\p{L})/u.test(p)) return "afterTomorrow";
  if (/(?<!\p{L})завтра(?!\p{L})/u.test(p)) return "tomorrow";
  if (/(?<!\p{L})сегодня(?!\p{L})/u.test(p)) return "today";
  return null;
}
function parseTime(value) {
  value = value.toLowerCase().replaceAll("ё", "е");
  // «в обед» / «в полдень» / «в полночь» — сразу известное время.
  const part = value.trim().match(new RegExp("^(" + daypartSource + ")$", "u"));
  if (part) return DAYPARTS[part[1]];
  const marker = value.match(/утра|вечера|дня|ночи/u)?.[0];
  // Минуты: «девятнадцать часов тридцать минут», «18 часов 30 минут».
  // Отрезаем их до разбора часа, иначе они попали бы в сумму и дали не то
  // время — «19 часов 30 минут» превращалось бы в 49:00.
  let minutes = 0;
  const minutePart = value.match(
    new RegExp(
      "(\\d{1,2}|" + Object.keys(numbers).join("|") + ")\\s*минут[а-яё]*",
      "iu",
    ),
  );
  if (minutePart) {
    const raw = minutePart[1];
    minutes = /^\d+$/.test(raw)
      ? Number(raw)
      : raw.split(/\s+/).reduce((a, w) => a + (numbers[w] ?? NaN), 0);
    value = value.replace(minutePart[0], " ");
  }
  const v = value.replace(/утра|вечера|дня|ночи|час(?:а|ов)?/gu, "").trim();
  let h,
    m = minutes;
  if (/^\d/.test(v)) {
    // «18:30» — минуты уже в записи через двоеточие, отдельные не нужны.
    if (v.includes(":")) [h, m = 0] = v.split(":").map(Number);
    else h = Number(v.split(/\s+/)[0]);
  } else h = v.split(/\s+/).reduce((a, w) => a + (numbers[w] ?? NaN), 0);
  if ((marker === "вечера" || marker === "дня") && h < 12) h += 12;
  if (marker === "ночи" && h === 12) h = 0;
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? pad(h) + ":" + pad(m) : null;
}
/**
 * Разбирает сказанную фразу в напоминание.
 *
 * options.dates — понимать ли даты, названные словами («завтра», «в пятницу»,
 * «25 декабря»). По умолчанию да, но в бесплатной версии распознавание дат
 * выключено: даты человек отмечает на календаре, а если не отметил — берётся
 * сегодняшний день. Время и событие голосом работают всегда.
 */
export function parseGroup(phrase, selectedDates = [], now = new Date(), options = {}) {
  const dateSpeech = options.dates !== false;
  let normalized = phrase.replace(
      new RegExp(
        "в\\s+(" +
          term +
          ")\\s*[,—-]?\\s*(?:нет|точнее|лучше)\\s*[,—-]?\\s*(?:в\\s+)?(" +
          term +
          ")",
        "giu",
      ),
      "в $2",
    ),
    times = [],
    ranges = [];
  for (const m of normalized.matchAll(timeClause)) {
    const parts = m[1].split(/\s*,\s*(?:в\s+)?|\s+и\s+(?:в\s+)?/u);
    const parsed = parts.map(parseTime);
    if (parsed.every(Boolean)) {
      times.push(...parsed);
      ranges.push({ index: m.index, length: m[0].length, time: parsed[0] });
    }
  }
  // Обороты вида «восемнадцать часов» — без предлога. Ищем только там, где
  // рядом нет предлога «в»: иначе одно и то же время нашлось бы дважды.
  for (const m of normalized.matchAll(hourClause)) {
    // «через два часа» и «каждые два часа» — отсчёт, а не время суток.
    if (countingBefore.test(normalized.slice(0, m.index))) continue;
    const before = normalized.slice(0, m.index);
    if (/(?<!\p{L})в\s*$/iu.test(before)) continue;
    const time = parseTime(m[1]);
    if (!time) continue;
    times.push(time);
    ranges.push({ index: m.index, length: m[0].length, time });
  }
  // Замены идут с конца строки, поэтому диапазоны должны быть в порядке
  // возрастания позиции: два прохода поиска выше дают их вперемешку.
  ranges.sort((a, b) => a.index - b.index);
  const ambiguous =
    ranges.length > 1 &&
    ranges
      .slice(0, -1)
      .some((v, i) =>
        /[а-яё]/iu.test(
          normalized
            .slice(v.index + v.length, ranges[i + 1].index)
            .replace(/(?:^|\s)(?:и|а)(?=\s|$)/giu, ""),
        ),
      );
  for (const x of ranges.reverse())
    normalized =
      normalized.slice(0, x.index) +
      "в " +
      x.time +
      normalized.slice(x.index + x.length);
  const parsed = parseIntent(dateSpeech ? normalized : dropDateWords(normalized), now, {
    dates: dateSpeech,
  });
  if (ambiguous)
    parsed.issues.push(
      "Разные события или расписания задайте по очереди кнопкой «Добавить»",
    );
  times = [...new Set(times)].sort();
  if (
    !times.length &&
    parsed.schedule?.kind === "once" &&
    !parsed.issues.some((e) => e.includes("время"))
  )
    times = [shortTime(parsed.schedule.at)];
  if (
    parsed.schedule.kind === "calendar" ||
    parsed.schedule.kind === "interval"
  ) {
    if (times.length && parsed.schedule.kind === "calendar")
      parsed.schedule.times = times;
    return {
      ...parsed,
      originalTranscript: phrase,
      times: parsed.schedule.times || [],
      dates: [],
      dateConflict:
        selectedDates.length > 0
          ? { recurring: true, calendarDates: [...selectedDates] }
          : null,
    };
  }
  const dateSpoken =
    dateSpeech &&
    /сегодня|завтра|послезавтра|понедель|вторник|сред[ау]|четверг|пятниц|суббот|воскрес|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|\d{1,2}[./]\d{1,2}/iu.test(
      normalized,
    );
  const spokenDate =
    dateSpoken && parsed.schedule.at
      ? localDate(new Date(parsed.schedule.at))
      : null;
  const dates = selectedDates.length
    ? [...selectedDates]
    : [spokenDate || localDate(now)];
  const issues = parsed.issues.filter(
    (e) =>
      !e.includes("время") &&
      !e.includes("Указанное время уже прошло") &&
      !e.includes("будущих дат"),
  );
  if (!times.length) issues.push("Во сколько напомнить?");
  const schedule =
    dateSpeech && /через\s/iu.test(normalized) && !selectedDates.length
      ? parsed.schedule
      : { ...defaultSchedule(now), kind: "dates", dates: dates.sort(), times };
  return {
    ...parsed,
    originalTranscript: phrase,
    schedule,
    dates:
      schedule.kind === "dates" && (selectedDates.length || spokenDate)
        ? dates
        : [],
    times,
    issues,
    dateConflict:
      dateSpeech &&
      (spokenDate || /через\s/iu.test(normalized)) &&
      selectedDates.length &&
      (selectedDates.length !== 1 || selectedDates[0] !== spokenDate)
        ? {
            spokenDate: spokenDate || localDate(new Date(parsed.schedule.at)),
            spokenSchedule: /через\s/iu.test(normalized)
              ? parsed.schedule
              : null,
            selectedDates,
          }
        : null,
  };
}
export function buildGroup(
  draft,
  now = Date.now(),
  { allowPast = false } = {},
) {
  if (!draft.text?.trim()) throw Error("Добавьте, о чём напомнить");
  if (draft.dateConflict) throw Error("Выберите, какие даты использовать");
  if (draft.issues?.length) throw Error(draft.issues.join(". "));
  const schedule =
    draft.schedule && draft.schedule.kind !== "dates"
      ? draft.schedule
      : {
          ...defaultSchedule(new Date(now)),
          ...(draft.schedule?.kind === "dates" ? draft.schedule : {}),
          kind: "dates",
          dates: draft.dates?.length
            ? [...new Set(draft.dates)].sort()
            : [localDate(new Date(now))],
          times: [...new Set(draft.times || [])].sort(),
        };
  if (schedule.kind === "dates") {
    if (!schedule.times.length) throw Error("Укажите время");
    const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
    if (schedule.dates.some((d) => !Number.isFinite(dateEpoch(d))))
      throw Error("Некорректная дата");
    if (
      !allowPast &&
      schedule.dates.some((d) =>
        schedule.times.some((t) => zonedTime(d, t, tz) <= now),
      )
    )
      throw Error(
        "Часть выбранных дат или времён уже прошла. Исправьте их перед сохранением",
      );
  }
  if (!nextOccurrences(schedule, now, 1).length)
    throw Error("Нет будущих срабатываний: проверьте дату и время");
  return {
    ...draft,
    text: draft.text.trim(),
    createdAt: draft.createdAt || now,
    schedule,
    enabled: draft.enabled ?? true,
  };
}
export function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    first: month + "-01",
    last: month + "-" + pad(new Date(Date.UTC(y, m, 0)).getUTCDate()),
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
    offset: (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7,
  };
}
export function occurrencesInMonth(rules, month) {
  const { first, last } = monthBounds(month),
    out = [];
  rules.forEach((r, index) => {
    if (!r.enabled) return;
    const tz =
        r.schedule.timezoneMode === "fixed" ? r.schedule.timezone : zone(),
      begin = zonedTime(first, "00:00", tz) - 1,
      end = zonedTime(last, "23:59", tz) + 60000;
    for (const t of nextOccurrences(r.schedule, begin, 5000)) {
      if (t >= end) break;
      out.push({
        id: r.id + "@" + t,
        reminderId: r.id,
        text: r.text,
        at: t,
        date: localDate(new Date(t)),
        time: shortTime(t),
        color: colorFor(r, index),
      });
    }
  });
  return out.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text));
}
