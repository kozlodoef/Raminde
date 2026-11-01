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
const term =
  numSource + "(?:\\s+час(?:а|ов)?)?(?:\\s+(?:утра|вечера|дня|ночи))?";
const timeClause = new RegExp(
  "(?<!\\p{L})в\\s+(" +
    term +
    "(?:\\s*(?:,|и)\\s*(?:в\\s+)?" +
    term +
    ")*)(?!\\p{L}|\\d)",
  "giu",
);
function parseTime(value) {
  value = value.toLowerCase().replaceAll("ё", "е");
  const marker = value.match(/утра|вечера|дня|ночи/u)?.[0];
  const v = value.replace(/утра|вечера|дня|ночи|час(?:а|ов)?/gu, "").trim();
  let h,
    m = 0;
  if (/^\d/.test(v)) {
    [h, m = 0] = v.split(":").map(Number);
  } else h = v.split(/\s+/).reduce((a, w) => a + (numbers[w] ?? NaN), 0);
  if ((marker === "вечера" || marker === "дня") && h < 12) h += 12;
  if (marker === "ночи" && h === 12) h = 0;
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? pad(h) + ":" + pad(m) : null;
}
export function parseGroup(phrase, selectedDates = [], now = new Date()) {
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
  const parsed = parseIntent(normalized, now);
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
    /через\s/iu.test(normalized) && !selectedDates.length
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
