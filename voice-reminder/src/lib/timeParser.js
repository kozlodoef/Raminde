// lib/timeParser.js
// "ИИ"-парсер: понимает дату и время, сказанные свободной формой на русском языке.
// Поддержка: "завтра в 5", "через два часа", "в пятницу вечером",
// "15 октября в 10 утра", "без четверти шесть", "полшестого", "половина десятого" и т.п.
// ВАЖНО: \b не работает с кириллицей, поэтому границы слов задаются явно через WB.

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

    // ---------- C. Время (раньше блока дат, чтобы "10 мая" не съелось как "в 10 ... мая") ----------
    // Часть суток ищем заранее и НЕ потребляем: она либо войдёт в состав
    // выражения времени ("в семь утра"), либо будет поглощена отдельно ниже.
    // Иначе два перекрывающихся совпадения рвут текст ("в семь" + "утра" → "Ть а").
    const podRe = mkRe("(?<!\\p{Ll})(" + join(PARTS_OF_DAY) + ")" + WB_R);
    const podHit = podRe.exec(s);
    const podSpan = podHit
      ? {
          index: podHit.index,
          match: podHit[0],
          value: PARTS_OF_DAY[podHit[1]],
        }
      : null;

    // Числовое: "15:30", "в 15.30" — предлог "в"/"у" забираем вместе со временем,
    // иначе он остаётся в тексте напоминания.
    {
      const m = eat(
        mkRe("(^|[^0-9.])(?:(?:в|у)\\s+)?(\\d{1,2}):(\\d{2})(?![0-9])"),
      );
      if (m && +m[2] <= 23 && +m[3] < 60) {
        hour = +m[2];
        minute = +m[3];
        timeFound = true;
        consumed[consumed.length - 1].index = m.index + m[1].length;
        consumed[consumed.length - 1].match = m[0].slice(m[1].length);
      } else if (m) {
        consumed.pop(); // совпадение не признано временем — не вырезаем его из текста
      }
    }

    // "без четверти шесть", "без пятнадцати три"
    if (hour === null) {
      const m = eat(
        mkRe(
          w("без") +
            "\\s+(четвер" +
            RU +
            "|" +
            NUM_EXPR +
            ")(?:\\s+минут)?\\s+(час[а-я]*|" +
            join(NUM_WORDS) +
            "|" +
            join(ORDINALS) +
            ")" +
            WB_R,
        ),
      );
      if (m) {
        const sub = /^четвер/.test(m[1]) ? 15 : wordToNum(m[1]);
        const hh = /^час/.test(m[2]) ? 1 : wordToNum(m[2]);
        if (hh && sub !== null && sub < 60) {
          hour = hh - 1;
          minute = 60 - sub;
          timeFound = true;
        }
      }
    }

    // "половина шестого", "половине десятого", "половину седьмого" — любые падежи.
    // Внимание: без флага u \w не включает кириллицу, поэтому окончание берём явным классом.
    if (hour === null) {
      const m = eat(
        mkRe(WB_L + "половин[а-яё]*\\s+(" + join(ORDINALS) + ")" + WB_R),
      );
      if (m) {
        hour = ORDINALS[m[1]] - 1;
        minute = 30;
        timeFound = true;
      }
    }

    // "полшестого", "пол-шестого", "пол девятого"
    if (hour === null) {
      const m = eat(mkRe(WB_L + "пол[-\\s]?(" + join(ORDINALS) + ")" + WB_R));
      if (m) {
        hour = ORDINALS[m[1]] - 1;
        minute = 30;
        timeFound = true;
      }
    }

    // "в семь часов", "в 5", "в час", "где-то в десять".
    // Если сразу за числом стоит часть суток ("в десять вечера", "в семь утра"),
    // поглощаем её здесь же: два перекрывающихся совпадения рвали текст
    // и теряли уточнение ("вечера" игнорировалось → 10:00 вместо 22:00).
    if (hour === null) {
      const m = eat(
        mkRe(
          "(?:где-то\\s+в|примерно\\s+в|около\\s+в|в|у)\\s+(" +
            NUM_EXPR +
            "|час" +
            RU +
            "|полтора)" +
            WB_R +
            "(?:\\s+(?:час" +
            RU +
            "|мин" +
            RU +
            "))?" +
            "(?:\\s+((?:" +
            join(PARTS_OF_DAY) +
            ")" +
            WB_R +
            "))?",
        ),
      );
      if (m) {
        let h = null;
        if (/^час/.test(m[1])) h = 1;
        else if (m[1] === "полтора") {
          h = 1;
          minute = 30;
        } else h = wordToNum(m[1]);
        if (h !== null && h >= 0 && h <= 23) {
          hour = h;
          timeFound = true;
          if (m[2]) pod = PARTS_OF_DAY[m[2]];
        }
      }
    }

    // "в шесть с четвертью"
    if (hour !== null && minute === 0) {
      if (eat(mkRe("с\\s+четверть(?:ю)?" + WB_R))) minute = 15;
    }

    // часть суток: "утра", "вечером"... — поглощаем один раз.
    // Если её уже забрало выражение времени ("в десять вечера"), не трогаем повторно.
    if (podSpan && pod === null) {
      pod = podSpan.value;
      consumed.push({ match: podSpan.match, index: podSpan.index });
    }

    // полдень / полночь
    if (hour === null) {
      if (eat(mkRe("полдень" + WB_R + "|полудня" + WB_R))) {
        hour = 12;
        timeFound = true;
      } else if (eat(mkRe("полночь" + WB_R + "|полуночи" + WB_R))) {
        hour = 0;
        timeFound = true;
      }
    }

    // ---------- D. Дата (после времени) ----------
    // "15 октября", "5 мая 2027", "двадцать пятое октября"
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
            "(?:\\s+(\\d{4}))?",
        ),
      );
      if (m) {
        const day = wordToNum(m[1]);
        const mon = MONTHS[m[2]];
        if (day >= 1 && day <= 31 && mon !== undefined) {
          let year = m[3] ? +m[3] : base.getFullYear();
          const probe = new Date(year, mon, day, 12);
          if (probe.getMonth() !== mon || probe.getDate() !== day)
            return {
              when: null,
              text: phrase,
              timeFound: false,
              dateFound: false,
              approx: true,
              error: "Такой даты не существует",
            };
          if (
            !m[3] &&
            probe <
              new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12)
          )
            year += 1;
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
              error: "Такой даты не существует",
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
