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
import {
  parseClockText,
  minutesAfterHour,
  formatClock,
  daypartIn,
  applyDaypart,
  daypartClock,
  DAYPARTS as LEX_DAYPARTS,
  CLOCK_SRC,
  BEZ_SRC,
  NUM_SRC,
} from "./time-lexicon.js";
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
// обед». Определение — в лексиконе, здесь только чтение.
const DAYPARTS = LEX_DAYPARTS;
const daypartSource = Object.keys(DAYPARTS).join("|");
// Как выглядит время — берём из лексикона (CLOCK_SRC). Раньше здесь был свой
// шаблон, из-за чего формы расходились: «10 30» понималось в одном модуле и
// не понималось в другом.
const term = CLOCK_SRC;
const timeClause = new RegExp(
  "(?<!\\p{L})в\\s+(" +
    term +
    "(?:\\s*(?:,|и)\\s*(?:в\\s+)?" +
    term +
    ")*)(?!\\p{L}|\\d)",
  "giu",
);
// Время часто называют без предлога: «восемнадцать часов полить цветы»,
// «без четверти шесть позвонить». Раньше такие обороты не находились, слова
// времени попадали в текст, а напоминание переспрашивало «Во сколько?».
//
// Берём обороты с явным признаком времени — слово «час» или «без»: без них
// под правило попадали бы любые числа («купить 2 хлеба» стало бы 02:00).
const hourClause = new RegExp(
  "(?<!\\p{L})((?:" +
    BEZ_SRC +
    "|" +
    NUM_SRC +
    "\\s+час[а-яё]*(?:\\s+" + CLOCK_SRC + ")?" +
    "))(?!\\p{L}|\\d)",
  "giu",
);
// «через два часа» и «каждые два часа» — это не время суток, а отсчёт или
// повтор. Их разбирает parseIntent, поэтому здесь такие обороты пропускаем.
// Окончание задаём явным классом: \w в JavaScript не включает кириллицу,
// и «кажд\w*» не поймало бы «каждые».
const countingBefore = /(?:через|кажд[а-яё]*|раз\s+в)\s*$/iu;

// Минуты сразу после часа — общее правило из лексикона: слово или цифры,
// но с оглядкой на дату («в 16 25 мая») и на количество («в 8 два хлеба»).
// Возвращает новые минуты и длину хвоста, который нужно вырезать из фразы.
function bareMinutesAfter(time, tail) {
  if (!time.endsWith(":00")) return null;
  const r = minutesAfterHour(tail);
  if (!r) return null;
  return { minutes: r.minutes, eat: r.eat };
}
/**
 * Убирает из фразы названную словами дату.
 *
 * Нужно для бесплатной версии: там распознаются только время и событие, а
 * дату человек отмечает на календаре. Без вырезания слова «завтра» и
 * «двадцать пятого декабря» попадали бы в текст напоминания — получалось бы
 * «Завтра полить цветы» вместо «Полить цветы».
 */
export function dropDateWords(phrase) {
  // Названия месяцев и дней недели перечислены формами целиком, а не
  // основой с «[а-яё]*»: основа ловила обычные слова, которые просто
  // начинаются так же, — «купить средство» превращалось в «купить»,
  // «купить мартышку» оставалось без первых двух слов.
  const months =
    "январ(?:ь|я|ю|ем|е)|феврал(?:ь|я|ю|ем|е)|март(?:а|у|ом|е)?|апрел(?:ь|я|ю|ем|е)|" +
    "ма[йя]|мае|маю|маем|июн(?:ь|я|ю|ем|е)|июл(?:ь|я|ю|ем|е)|август(?:а|у|ом|е)?|" +
    "сентябр(?:ь|я|ю|ем|е)|октябр(?:ь|я|ю|ем|е)|ноябр(?:ь|я|ю|ем|е)|декабр(?:ь|я|ю|ем|е)";
  const weekdays =
    "понедельник(?:а|у|ом|е)?|вторник(?:а|у|ом|е)?|сред(?:а|у|ой|ою|е|ам|ах|ами)|" +
    "четверг(?:а|у|ом|е)?|пятниц(?:а|у|ей|ею|е|ам|ах|ами)|" +
    "суббот(?:а|у|ой|ою|е|ам|ах|ами)|воскресень(?:е|я|ю|ем|и|ям|ях|ями)";
  // Порядковое число дня («двадцать пятого», «первого»). Нужен ограниченный
  // набор основ: без него «[а-яё]+\s+» перед месяцем съедало любое слово.
  const dayOrdinal =
    "(?:(?:двадцать|тридцать)\\s+)?(?:" +
    "перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят|одиннадцат|двенадцат|" +
    "тринадцат|четырнадцат|пятнадцат|шестнадцат|семнадцат|восемнадцат|девятнадцат|" +
    "двадцат|тридцат)[а-яё]*";
  // Границы слов задаём просмотром, а не \b: в JavaScript \b не считает
  // кириллицу буквами, и «завтра» им не ловится вовсе.
  const LB = "(?<!\\p{L})";
  const RB = "(?!\\p{L})";
  // Пробелы по краям сохраняем: их набирает человек прямо сейчас. Раньше
  // хвостовой пробел срезался, поле через мгновение показывало текст без
  // него, и следующее слово печаталось вплотную — «купить хлеб» превращалось
  // в «купитьхлеб». Ровно та же причина была в toDigits, там пробел уже
  // сохраняется; здесь её недоставало.
  const leading = phrase.match(/^\s*/)[0];
  const trailing = phrase.match(/\s*$/)[0];
  const core = phrase
    .replace(
      // «двадцать пятого декабря», «25 декабря», «5 мая 2027».
      // Предлог захватываем вместе с датой: иначе после удаления он оставался
      // висеть («в мае поехать» → «в поехать»). Времени это не касается —
      // там предлог стоит перед цифрами или словом часа, а не месяцем.
      new RegExp(
        "(?:(?:в|во|на|по|с|до)\\s+)?(?:(?:\\d{1,2}|" +
          dayOrdinal +
          ")\\s+)?(?:" +
          months +
          ")" +
          RB +
          "(?:\\s+\\d{4})?",
        "giu",
      ),
      " ",
    )
    .replace(
      // «25.12», «25/12/2026». Но НЕ «10.30»: вторая часть больше 12 —
      // это время (10:30), а не дата. Раньше оно удалялось как дата, и
      // разбирать становилось нечего.
      //
      // И не «25.» / «25.1»: это ещё не дата, а незаконченный набор. Раньше
      // такие огрызки удалялись, и текст рассыпался прямо под руками.
      // Поэтому месяц требуем двузначным — «25.12»; именно в таком виде дату
      // и пишет само приложение, а «25.1» человек ещё дописывает.
      new RegExp(
        "(?<![\\d./])\\d{1,2}[./](?:0[1-9]|1[0-2])(?:[./]\\d{2,4})?(?![\\d./])",
        "gu",
      ),
      " ",
    )
    .replace(
      // «в пятницу», «следующий вторник», «по средам»
      new RegExp(
        // Перечень дней недели обязательно в группе: без неё альтернатива
        // «|» разрывает весь шаблон, и ветки после первой теряют и границу
        // слова, и предлог — «в пятницу» превращалось в «в позвонить маме».
        LB + "(?:(?:в|во|по|на)\\s+)?(?:следующ[а-яё]*\\s+)?(?:" + weekdays + ")" + RB,
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
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .trim();
  if (!core) return phrase; // фраза из одних пробелов остаётся как была
  // Двоеточие в конце не срезаем: человек набирает «в 10:30» и уже поставил
  // его. Раньше знак пропадал, и следующая цифра вставала на его место —
  // получалось «в 1030».
  const tail = trailing.endsWith(":") || core.endsWith(":") ? trailing : trailing.replace(/[:\-]+$/, "");
  return leading + core + tail;
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
/**
 * Разбирает вырезанную из фразы «порцию» времени в «ЧЧ:ММ».
 *
 * Вся работа — в лексиконе (parseClockText): он знает цифры, точку, пробел,
 * слова, «часов»/«минут», дроби и «без N …». Здесь только часть суток —
 * она меняет час, поэтому применяется после разбора.
 */
function parseTime(value, neighbours = "") {
  const text = String(value || "").toLowerCase().replaceAll("ё", "е").trim();
  // «обед», «полдень», «полночь» — сразу известное время. «Обед» берём
  // только когда рядом нет другой части суток: «днём обед» — это еда.
  const direct = daypartClock(text, neighbours);
  if (direct) return direct;
  if (DAYPARTS[text]) return null;
  const c = parseClockText(text, neighbours);
  if (!c) return null;
  const part = daypartIn(text);
  const hour = part ? applyDaypart(c.hour, part) : c.hour;
  return formatClock(hour, c.minute);
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
    const parsed = parts.map((p) => parseTime(p, normalized));
    if (parsed.every(Boolean)) {
      // «в 16:00 тридцать»: минуты словом добираем к последнему времени
      // и расширяем диапазон, чтобы слово не осталось в тексте.
      let length = m[0].length;
      const last = parsed[parsed.length - 1];
      const bm = bareMinutesAfter(
        last,
        normalized.slice(m.index + m[0].length),
      );
      if (bm) {
        parsed[parsed.length - 1] = last.slice(0, 2) + ":" + pad(bm.minutes);
        length += bm.eat;
      }
      times.push(...parsed);
      ranges.push({ index: m.index, length, time: parsed[0] });
    }
  }
  // Обороты вида «восемнадцать часов» — без предлога. Ищем только там, где
  // рядом нет предлога «в»: иначе одно и то же время нашлось бы дважды.
  for (const m of normalized.matchAll(hourClause)) {
    // «через два часа» и «каждые два часа» — отсчёт, а не время суток.
    if (countingBefore.test(normalized.slice(0, m.index))) continue;
    const before = normalized.slice(0, m.index);
    if (/(?<!\p{L})в\s*$/iu.test(before)) continue;
    let time = parseTime(m[1], normalized);
    if (!time) continue;
    // «восемнадцать часов тридцать» — то же правило, что и в «в …».
    let length = m[0].length;
    const bm = bareMinutesAfter(
      time,
      normalized.slice(m.index + m[0].length),
    );
    if (bm) {
      time = time.slice(0, 2) + ":" + pad(bm.minutes);
      length += bm.eat;
    }
    times.push(time);
    ranges.push({ index: m.index, length, time });
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
