// lib/timeParser.js
// "ИИ"-парсер: понимает дату и время, сказанные свободной формой на русском языке.
// Поддержка: "завтра в 5", "через два часа", "в пятницу вечером",
// "15 октября в 10 утра", "без четверти шесть", "полшестого", "половина десятого" и т.п.
// ВАЖНО: \b не работает с кириллицей, поэтому границы слов задаются явно через WB.

// Как выглядят и разбираются все формы времени — в одном месте.
import {
  CLOCK_SRC,
  parseClockPrefix,
  minutesAfterHour,
  looksLikeTime,
} from "../domain/time-lexicon.js";
// Даты словами («двадцать пятого декабря») — тоже из общего модуля, чтобы
// голос, сохранение и поле ввода понимали их одинаково.
import { spokenDate } from "../domain/dates-spoken.js";

const NUM_WORDS = {
  ноль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
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
  // Часы 13–19 одним словом («шестнадцать»). Без них «в шестнадцать
  // тридцать» не считался временем вовсе — распознаватель отдаёт именно так.
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
};

// Родительный падеж ("которого") — для "пол-Х", "половина Х", "без N Х"
const ORDINALS = {
  первого: 1,
  второго: 2,
  третьего: 3,
  четвертого: 4,
  пятого: 5,
  шестого: 6,
  седьмого: 7,
  восьмого: 8,
  девятого: 9,
  десятого: 10,
  одиннадцатого: 11,
  двенадцатого: 12,
};

const WEEKDAYS = {
  понедельник: 1,
  понедельника: 1,
  понедельнику: 1,
  вторник: 2,
  вторника: 2,
  вторнику: 2,
  среду: 3,
  среда: 3,
  среды: 3,
  четверг: 4,
  четверга: 4,
  четвергу: 4,
  пятницу: 5,
  пятница: 5,
  пятницы: 5,
  субботу: 6,
  суббота: 6,
  субботы: 6,
  воскресенье: 0,
  воскресенья: 0,
  воскресенью: 0,
};

const MONTHS = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

const PARTS_OF_DAY = {
  утра: "morning",
  утром: "morning",
  дня: "afternoon",
  днём: "afternoon",
  днем: "afternoon",
  вечера: "evening",
  вечером: "evening",
  ночи: "night",
  ночью: "night",
};

const DEFAULT_HOUR = { morning: 9, afternoon: 15, evening: 19, night: 23 };

const TENS = { двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50 };

// Минуты, идущие СЛОВОМ сразу после часа: «в шесть тридцать», «16:00
// тридцать». Распознаватель часто отдаёт час (цифрой или словом) и отдельно
// слово минуты — без этого шага слово остаётся в тексте, а время становится
// «полным» (16:00 вместо 16:30). Числа (цифры) сюда намеренно НЕ входят:
// голое число после часа может оказаться днём месяца («в 16 25 мая»).
// «четверть»/«половина» в этом обороте не используются — «половина шестого»
// разбирается отдельно.
const MINUTE_REFINE_WORDS = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12,
  тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  ...TENS,
};
// Слово, похожее на инфинитив глагола («позвонить», «поесть», «лечь»).
// Минуты словами идут в конце фразы или перед глаголом действия:
// «в 16:00 тридцать позвонить маме». За количеством стоит существительное:
// «в 8 два хлеба купить» — «хлеба» глаголом не пахнет, значит «два» — это
// количество, а не минуты.
const VERB_AFTER = /(?:[а-яёы]ть|сти)$/;
// Единицы для составных минут «двадцать пять».
const MINUTE_UNITS =
  "один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|\\d";

// Граница слова, совместимая с кириллицей: перед/после слова — не буква и не цифра.
// В файле ниже используются реальные символы а-я/ё, чтобы избежать проблем с экранированием.
const WB_L = "(?<!\\p{Ll})"; // левая граница слова (юникод-буквы в нижнем регистре)
const WB_R = "(?!\\p{Ll})"; // правая граница слова
const w = (word) => WB_L + word + WB_R; // обёртка для точного слова/фразы без пробелов

// Внимание: \w в JavaScript НЕ включает кириллицу, поэтому для русских окончаний
// используем явный класс. Без него шаблоны вида "час\w*" не матчат "часа".
const RU = "[а-яё]*";

function wordToNum(ww) {
  if (/^\d+$/.test(ww)) return parseInt(ww, 10);
  const k = String(ww).toLowerCase().replace(/ё/g, "е");
  if (NUM_WORDS[k] !== undefined) return NUM_WORDS[k];
  if (ORDINALS[k] !== undefined) return ORDINALS[k];
  let val = 0;
  for (const p of k.split(/[\s-]+/)) {
    if (TENS[p] !== undefined) val += TENS[p];
    else if (NUM_WORDS[p] !== undefined) val += NUM_WORDS[p];
    else return null;
  }
  return val || null;
}

/** Значение минут, сказанных словом после часа («тридцать» → 30). */
function minuteRefineValue(tok) {
  const k = String(tok).toLowerCase().replace(/ё/g, "е").trim();
  const parts = k.split(/[\s-]+/);
  if (parts.length === 2 && TENS[parts[0]] !== undefined) {
    const u = /^\d+$/.test(parts[1]) ? +parts[1] : NUM_WORDS[parts[1]];
    if (u !== undefined && u !== null) return TENS[parts[0]] + u;
  }
  if (MINUTE_REFINE_WORDS[k] !== undefined) return MINUTE_REFINE_WORDS[k];
  return null;
}

const join = (o) => Object.keys(o).join("|");
// Группировка без захвата. Собираем шаблоны только через неё: при ручной
// склейке строк потерянная скобка делает шаблон тихо неверным.
const grp = (src) => "(?:" + src + ")";

const NUM_ALT = "\\d{1,2}|" + join(NUM_WORDS);
// Число (слово или цифра): составные "двадцать пять", круглые десятки
// "тридцать минут" и одиночные "два".
// ВАЖНО: длинные формы должны идти РАНЬШЕ коротких. Если поставить NUM_ALT
// первым, альтернатива "три" совпадёт внутри слова "тридцать" и число
// посчитается как 3 вместо 30. Сам десяток необязателен ("тридцать минут"),
// но вместе с единицей — "двадцать пять".
const TEN_WORDS = grp(join(TENS) + "|пятьдесят");
const NUM_EXPR = grp(
  grp(grp(TEN_WORDS + grp("[- ]" + grp(NUM_ALT)) + "?") + "|" + NUM_ALT),
);
// Слова минут сразу после часа (см. MINUTE_REFINE_WORDS). Десятки — отдельно,
// одиночные слова — длиннее первыми, чтобы «пятнадцать» не съелось как «пять».
const MINUTE_REFINE = grp(
  // Важно: «?» относится к группе единиц, а не к одному десятку — иначе
  // «двадцать пять» съелось бы как «двадцать», и «пять» осталось бы в тексте.
  grp(join(TENS)) + grp("[- ]" + grp(MINUTE_UNITS)) + "?" +
    "|" +
    Object.keys(MINUTE_REFINE_WORDS)
      .filter((k) => !(k in TENS))
      .sort((a, b) => b.length - a.length)
      .join("|"),
);

/**
 * parseReminder(фраза, baseDate?) →
 * { when: Date, text: string, timeFound: bool, dateFound: bool, approx: bool }
 */
// Все паттерны собираются из строк. Флаг u обязателен: без него \p{Ll}
// в WB_L/WB_R не является свойством Unicode, границы слов ломаются и слова
// обрезаются по неверной позиции ("через два часа" → "через два час").
function mkRe(pattern, flags) {
  return new RegExp(pattern, flags ? flags + "u" : "u");
}

export function parseReminder(phrase, baseArg) {
  const base = baseArg || new Date();
  if (!phrase)
    return {
      when: null,
      text: "",
      timeFound: false,
      dateFound: false,
      approx: true,
    };

  const original = phrase.replace(/\s+/g, " ").trim();
  const s = original.toLowerCase().replace(/ё/g, "е");
  const consumed = [];
  const eat = (re) => {
    const m = s.match(re);
    if (m) consumed.push({ match: m[0], index: m.index });
    return m;
  };

  let dayOffset = null; // сдвиг в днях от base
  let absDate = null; // {y,m,d}
  let hour = null,
    minute = 0;
  let hourTokenEnd = null; // позиция сразу после часа — для минут словом
  let pod = null; // часть суток
  let timeFound = false,
    dateFound = false;
  let relResult = null; // результат для "через N ..."

  // ---------- A. "через N минут/часов/дней/недель" ----------
  // Единица времени. Правая граница — положительный просмотр "пробел или конец",
  // а НЕ (?!\p{Ll}): та требует, чтобы [а-яё]* остановился ровно перед пробелом,
  // и если слово длиннее основы ("минуту"), совпадение ломается целиком.
  const UNIT =
    "(?:секунд" +
    RU +
    "|минут" +
    RU +
    "|час" +
    RU +
    "|дн" +
    RU +
    "|ден" +
    RU +
    "|суток" +
    RU +
    "|нед" +
    RU +
    "|месяц" +
    RU +
    ")(?=\\s|$)";

  // Считаем результат "через N <единица>" от base.
  const relFrom = (n, unit) => {
    const d = new Date(base);
    if (unit.startsWith("секунд")) d.setSeconds(d.getSeconds() + Math.round(n));
    else if (unit.startsWith("минут"))
      d.setMinutes(d.getMinutes() + Math.round(n));
    else if (unit.startsWith("час"))
      d.setMinutes(d.getMinutes() + Math.round(n * 60));
    else if (/^(дн|ден|суток)/.test(unit))
      d.setDate(d.getDate() + Math.round(n));
    else if (unit.startsWith("нед")) d.setDate(d.getDate() + Math.round(n * 7));
    else d.setMonth(d.getMonth() + Math.round(n));
    return d;
  };
  const applyRel = (m, token) => {
    // "полтора часа" = 90 минут: wordToNum это слово не знает.
    const n = wordToNum(token);
    relResult = relFrom(n === null && /^полтор/.test(token) ? 1.5 : n, m[2]);
    consumed.push({ match: m[0], index: m.index });
  };

  // "полчаса" — отдельное слово, а не "<число> <единица>", поэтому проверяем отдельно.
  {
    const m = s.match(mkRe(w("через") + "\\s+полчаса" + WB_R));
    if (m) {
      const d = new Date(base);
      d.setMinutes(d.getMinutes() + 30);
      relResult = d;
      consumed.push({ match: m[0], index: m.index });
    }
  }

  // "через час", "через минуту", "через неделю" — число не названо, значит один.
  if (!relResult) {
    const m = s.match(mkRe(w("через") + "\\s+(" + UNIT + ")" + WB_R));
    if (m) {
      relResult = relFrom(1, m[1]);
      consumed.push({ match: m[0], index: m.index });
    }
  }

  // "через два часа", "через двадцать пять минут", "через тридцать минут".
  // Число берём через NUM_EXPR: он покрывает и одиночные, и составные, и
  // круглые десятки. Отдельный шаблон для составных не нужен — NUM_EXPR уже
  // проверяет длинные формы раньше коротких.
  if (!relResult) {
    const m = s.match(
      mkRe(
        w("через") +
          "\\s+(полторы|полтора|" +
          NUM_EXPR +
          ")\\s+(" +
          UNIT +
          ")" +
          WB_R,
      ),
    );
    if (m) applyRel(m, m[1]);
  }

  // ---------- B. Абсолютная дата и время ----------
  if (!relResult) {
    // "послезавтра / завтра / сегодня / вчера"
    if (eat(mkRe(w("послезавтра")))) {
      dayOffset = 2;
      dateFound = true;
    } else if (eat(mkRe(w("завтра")))) {
      dayOffset = 1;
      dateFound = true;
    } else if (eat(mkRe(w("сегодня")))) {
      dayOffset = 0;
      dateFound = true;
    } else if (eat(mkRe(w("вчера")))) {
      dayOffset = -1;
      dateFound = true;
    }

    // день недели: "в пятницу", "в следующий вторник"
    if (dayOffset === null) {
      const m = eat(
        mkRe("(?:в\\s+)?(?:следующ\\w*\\s+)?(" + join(WEEKDAYS) + ")" + WB_R),
      );
      if (m) {
        const target = WEEKDAYS[m[1]];
        let diff = (target - base.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        dayOffset = diff;
        dateFound = true;
      }
    }

    // ---------- C. Время ----------
    // ---------- C0. Дата словами — ДО времени ----------
    // «двадцать пятого декабря» — это дата, но числительное «двадцать»
    // похоже на час, и время перехватывало его: выходило 20:00 сегодня, а
    // «пятого декабря в 19:30» уезжало в текст напоминания.
    //
    // Поэтому дату словами ищем первым делом и запоминаем её границы: всё,
    // что попало в дату, время уже не рассматривает.
    let masked = null;
    if (dayOffset === null && !absDate) {
      // needMonth: «половина одиннадцатого», «четверть седьмого» и «тридцать
      // минут одиннадцатого» — это время, а не 11-е и 7-е число. Датой
      // считаем только оборот с названием месяца («двадцать пятого декабря»).
      const said = spokenDate(s, base, { needMonth: true });
      if (said) {
        const at = s.indexOf(said.match);
        if (at >= 0) {
          const [y, mo, day] = said.date.split("-").map(Number);
          absDate = { y, m: mo - 1, d: day };
          dateFound = true;
          consumed.push({ match: said.match, index: at });
          // Маска той же длины: позиции в строке не сдвигаются, но время
          // внутри даты больше не находится.
          masked = s.slice(0, at) + " ".repeat(said.match.length) + s.slice(at + said.match.length);
        }
      }
    }
    // Часть суток ищем заранее: она либо войдёт в совпадение времени
    const podRe = mkRe("(?<!\\p{Ll})(" + join(PARTS_OF_DAY) + ")" + WB_R);
    const podHit = podRe.exec(s);
    const podSpan = podHit
      ? {
          index: podHit.index,
          match: podHit[0],
          value: PARTS_OF_DAY[podHit[1]],
        }
      : null;
    // Единый поиск времени по шаблону лексикона: он знает все формы —
    // «10:30», «10.30», «10 30», «десять тридцать», «половина одиннадцатого»,
    // «без пятнадцати шесть», «полдень», «10 часов 30 минут». Раньше здесь
    // было несколько отдельных шаблонов, и новая форма появлялась только в
    // одном из них: «10:30» работало, «10 30» — нет.
    //
    // Шаблон намеренно широкий и может поймать дату («16 25 мая»). Решение
    // принимает разбор: parseClockText возвращает null, и запись отбрасывается.
    if (hour === null) {
      // Ищем по строке с замаскированной датой: «двадцать пятого декабря» не
      // должно дать 20:00. Позиции совпадают с исходной строкой, поэтому
      // вырезаем по ней же.
      const scan = masked || s;
      const re = mkRe("(?:где-то\\s+в|примерно\\s+в|около\\s+в|в|у)?\\s*(" + CLOCK_SRC + ")", "gi");
      for (const m of scan.matchAll(re)) {
        const token = m[1];
        // Предлог «в» перед временем забираем вместе со временем, иначе он
        // остаётся в тексте напоминания: «Купить хлеб в».
        const lead = m[0].slice(0, m[0].indexOf(token));
        const start = m.index + lead.length;
        // Граница слева: перед временем не должно быть буквы или цифры —
        // иначе «10:30» нашлось бы внутри слова или длинного числа.
        const before = start > 0 ? s[start - 1] : "";
        if (before && /[\p{L}\d]/u.test(before)) continue;
        // Голое число — время только с предлогом или словом-признаком.
        // Без этого «купить 2 хлеба» превращалось в напоминание на 02:00.
        if (!lead.trim() && !looksLikeTime(token)) continue;
        const c = parseClockPrefix(token, s);
        if (!c) continue;
        hour = c.hour;
        minute = c.minute;
        timeFound = true;
        // Шаблон мог захватить лишнее слово справа («в 8 два хлеба»):
        // вырезаем только ту часть, которая действительно время.
        hourTokenEnd = start + c.length;
        consumed.push({ match: s.slice(start, start + c.length), index: start });
        // Предлог относился ко времени: «купить хлеб в 16:00» давало текст
        // «Купить хлеб в», а «в январе в 9 утра» — «В проверять».
        if (lead.trim()) consumed.push({ match: lead, index: m.index });
        break;
      }
    }

    // Часть суток: «в десять вечера» → 22:00. Ищем отдельно от часа, потому
    // что она может стоять и до него, и после, и сама менять час.
    if (podSpan) {
      pod = podSpan.value;
      // Слово суток могло уже войти в совпадение времени — тогда не вырезаем
      // его второй раз (иначе в тексте останется дыра из пробелов).
      const alreadyEaten = consumed.some(
        (x) => podSpan.index >= x.index && podSpan.index < x.index + x.match.length,
      );
      if (!alreadyEaten) consumed.push({ match: podSpan.match, index: podSpan.index });
    }

    // ---------- Минуты сразу после часа ----------
    // «16:00 тридцать», «10:00 30», «в шестнадцать тридцать». Распознаватель
    // часто отдаёт час и минуты раздельно, и без этого шага слово застревало в
    // тексте, а время становилось «полным» (16:00 вместо 16:30).
    //
    // Правило одно на всё приложение и живёт в лексиконе: цифры не берутся
    // перед месяцем («в 16 25 мая» — это дата), слова — только в конце фразы,
    // перед «минут» или перед глаголом действия («в 8 два хлеба» — количество).
    if (hour !== null && minute === 0 && hourTokenEnd !== null) {
      const r = minutesAfterHour(s.slice(hourTokenEnd));
      if (r) {
        minute = r.minutes;
        consumed.push({
          match: s.slice(hourTokenEnd, hourTokenEnd + r.eat),
          index: hourTokenEnd,
        });
      }
    }

    // ---------- D. Дата (после времени) ----------
    // "15 октября", "5 мая 2027", "5 мая 2027 года", "двадцать пятое октября"
    if (dayOffset === null && !absDate) {
      const m = eat(
        mkRe(
          "(" +
            NUM_EXPR +
            ")" +
            "(?:\\s+(?:числа|го))?\\s+(" +
            join(MONTHS) +
            ")" +
            WB_R +
            // Год принимаем и с словом: «2027 года», «2027 г.». Раньше бралось
            // только голое число, и «года» оставалось в тексте напоминания.
            "(?:\\s+(\\d{4})\\s*(?:год[а-яё]*\\.?|г\\.?)?)?",
        ),
      );
      if (m) {
        const day = wordToNum(m[1]);
        const mon = MONTHS[m[2]];
        if (day >= 1 && day <= 31 && mon !== undefined) {
          const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
          const exists = (y) => {
            const d = new Date(y, mon, day, 12);
            return d.getMonth() === mon && d.getDate() === day;
          };
          let year;
          if (m[3]) {
            year = +m[3];
            if (!exists(year))
              return {
                when: null,
                text: phrase,
                timeFound: false,
                dateFound: false,
                approx: true,
                error: "Такой даты не бывает. Проверьте день и месяц.",
              };
          } else {
            // Ближайший год, где такой день есть и ещё не прошёл. Для
            // 29 февраля это ближайший високосный год, а не потеря даты:
            // раньше проверка шла по текущему году, и в невисокосный
            // «двадцать девятого февраля» отбрасывалось целиком.
            year = base.getFullYear();
            for (let i = 0; i <= 8; i++) {
              const y = base.getFullYear() + i;
              if (!exists(y)) continue;
              if (new Date(y, mon, day, 12) >= today) {
                year = y;
                break;
              }
            }
            if (!exists(year))
              return {
                when: null,
                text: phrase,
                timeFound: false,
                dateFound: false,
                approx: true,
                error: "Такой даты не бывает. Проверьте день и месяц.",
              };
          }
          absDate = { y: year, m: mon, d: day };
          dateFound = true;
        }
      }
    }

    // числовая дата: "15.10", "15/10/2026"
    if (dayOffset === null && !absDate) {
      const m = eat(
        /(^|[^0-9:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![0-9:])/,
      );
      if (m) {
        let day = +m[2],
          mon = +m[3] - 1;
        if (mon < 0 || mon > 11) {
          const t = day;
          day = mon + 1;
          mon = t - 1;
        }
        if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
          const year = m[4]
            ? +m[4] < 100
              ? 2000 + +m[4]
              : +m[4]
            : base.getFullYear();
          const probe = new Date(year, mon, day);
          if (probe.getMonth() !== mon || probe.getDate() !== day)
            return {
              when: null,
              text: phrase,
              timeFound: false,
              dateFound: false,
              approx: true,
              error: "Такой даты не бывает. Проверьте день и месяц.",
            };
          absDate = { y: year, m: mon, d: day };
          dateFound = true;
          consumed[consumed.length - 1].index = m.index + m[1].length;
          consumed[consumed.length - 1].match = m[0].slice(m[1].length);
        }
      }
    }
  }

  // ---------- Сборка ----------
  let when;
  if (relResult) {
    when = relResult;
    timeFound = true;
    dateFound = true;
  } else {
    when = new Date(base);
    if (absDate) when = new Date(absDate.y, absDate.m, absDate.d, 0, 0, 0);
    else if (dayOffset !== null) {
      when.setDate(when.getDate() + dayOffset);
      when.setHours(0, 0, 0, 0);
    } else when.setHours(0, 0, 0, 0);

    if (hour !== null) {
      let h = hour;
      if (pod === "morning") {
        if (h === 12) h = 0;
      } else if (pod === "afternoon") {
        if (h >= 1 && h <= 5) h += 12;
      } else if (pod === "evening") {
        if (h >= 1 && h <= 11) h += 12;
      } // 10 вечера → 22:00
      else if (pod === "night") {
        if (h >= 8 && h <= 11) h += 12;
        if (h === 12) h = 0;
      }
      h = ((h % 24) + 24) % 24;
      when.setHours(h, minute, 0, 0);
    } else if (pod) {
      when.setHours(DEFAULT_HOUR[pod], 0, 0, 0);
      timeFound = true;
    } else if (!dateFound) {
      // Ни времени, ни даты — предложим через час (приблизительно)
      when = new Date(base.getTime() + 60 * 60 * 1000);
      return {
        when,
        text: cap(cleanup(stripConsumed(original, consumed))) || "Напоминание",
        timeFound: false,
        dateFound: false,
        approx: true,
      };
    }

    // Перенос на завтра, если указан только день без времени и он уже "прошёл" (сегодня)
    if (!timeFound && dayOffset === 0 && when <= base)
      when.setDate(when.getDate() + 1);
    // Явная абсолютная дата ("15 октября") не сдвигается из-за прошедшего часа.
    if (timeFound && !absDate && dayOffset === null && when <= base)
      when.setDate(when.getDate() + 1);
  }

  const text = cap(cleanup(stripConsumed(original, consumed))) || "Напоминание";
  return { when, text, timeFound, dateFound, approx: !timeFound };
}

function stripConsumed(s, consumed) {
  let out = s;
  const ranges = consumed
    .map((x) => [x.index, x.index + x.match.length])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of ranges) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  merged.reverse().forEach(([a, b]) => {
    out = out.slice(0, a) + " " + out.slice(b);
  });
  return out.replace(/\s+/g, " ").trim();
}

function cleanup(text) {
  let t = text
    // Сначала убираем глагол ("напомни", "напомнить"), чтобы слово даты
    // оказалось в начале строки и следующий шаг его увидел.
    .replace(
      mkRe(
        "напомин" + RU + "|напомн" + RU + "|напоминание|не забудь|помяни",
        "gi",
      ),
      " ",
    )
    .replace(/^\s*(чтобы|про|насчёт|на счёт|о том что|что)\s+/i, "")
    .trim();
  return (
    t
      // Дата и день недели уже показаны отдельно ("Завтра 07:00 | ..."),
      // поэтому в тексте действия ведущее слово даты избыточно.
      .replace(
        mkRe(
          "^\\s*в?\\s*(?:послезавтра|завтра|сегодня|вчера|(?:" +
            join(WEEKDAYS) +
            "))\\s+",
          "i",
        ),
        "",
      )
      .replace(mkRe(w("мне") + "|" + w("нам") + "|" + w("меня"), "gi"), " ")
      .replace(mkRe(w("пожалуйста"), "gi"), " ")
      .replace(
        mkRe(
          w("где-то") +
            "|" +
            w("примерно") +
            "|" +
            w("приблизительно") +
            "|" +
            w("около"),
          "gi",
        ),
        " ",
      )
      // Осиротевший предлог: выражение времени вырезано ("... в половине десятого ..."),
      // а "в" осталось висеть отдельным словом.
      .replace(/^\s*в(?:\s+|$)/iu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
      .trim()
  );
}

function cap(t) {
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatWhen(d) {
  if (!d) return "";
  const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const months = [
    "янв",
    "фев",
    "мар",
    "апр",
    "мая",
    "июн",
    "июл",
    "авг",
    "сен",
    "окт",
    "ноя",
    "дек",
  ];
  const now = new Date();
  const sameDay = (x, y) =>
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate();
  const hhmm =
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0");
  if (sameDay(d, now)) return `Сегодня ${hhmm}`;
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  if (sameDay(d, tmr)) return `Завтра ${hhmm}`;
  const yst = new Date(now);
  yst.setDate(yst.getDate() - 1);
  if (sameDay(d, yst)) return `Вчера ${hhmm}`;
  return `${d.getDate()} ${months[d.getMonth()]}, ${days[d.getDay()]} ${hhmm}`;
}
