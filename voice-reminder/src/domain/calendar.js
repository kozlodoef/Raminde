const DAY = 86400000;
export const zone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const pad = (n) => String(n).padStart(2, "0");
export function localDate(d = new Date(), timeZone = zone()) {
  const p = parts(d, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
const formatters = new Map();
export function parts(date, timeZone) {
  if (!formatters.has(timeZone))
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    );
  const p = Object.fromEntries(
    formatters
      .get(timeZone)
      .formatToParts(date)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, +x.value]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute };
}
export function dateEpoch(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return NaN;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === y &&
    x.getUTCMonth() === m - 1 &&
    x.getUTCDate() === d
    ? t
    : NaN;
}
// Resolve a wall clock using Intl. For DST gaps select the first valid wall minute;
// for overlaps select the first occurrence. No dependency on the machine timezone.
export function zonedTime(date, time, tz) {
  const day = dateEpoch(date);
  if (!Number.isFinite(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    return NaN;
  const [h, m] = time.split(":").map(Number),
    desired = day + h * 3600000 + m * 60000;
  let t = desired;
  for (let i = 0; i < 5; i++) {
    const p = parts(new Date(t), tz);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    const delta = desired - wall;
    if (!delta) break;
    t += delta;
  }
  const resolved = parts(new Date(t), tz);
  if (
    Date.UTC(
      resolved.y,
      resolved.m - 1,
      resolved.d,
      resolved.h,
      resolved.min,
    ) === desired
  ) {
    let first = t;
    for (let minutes = 15; minutes <= 180; minutes += 15) {
      const earlier = t - minutes * 60000,
        p = parts(new Date(earlier), tz);
      if (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) === desired)
        first = Math.min(first, earlier);
    }
    return first;
  }
  let best = Infinity,
    gap = Infinity,
    gapWall = Infinity;
  for (let offset = -180; offset <= 180; offset++) {
    const v = t + offset * 60000,
      p = parts(new Date(v), tz);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (wall === desired) best = Math.min(best, v);
    if (wall > desired && wall < gapWall) {
      gapWall = wall;
      gap = v;
    }
  }
  return Number.isFinite(best) ? best : gap;
}
export function defaultSchedule(now = new Date()) {
  return {
    kind: "once",
    at: new Date(now.getTime() + 3600000).toISOString(),
    frequency: "daily",
    interval: 1,
    anchorDate: localDate(now),
    weekdays: [],
    monthDays: [],
    months: [],
    dayParity: "any",
    times: ["09:00"],
    timezoneMode: "deviceLocal",
    timezone: zone(),
    excludedDates: [],
    excludedInstants: [],
    excludedWeekdays: [],
    until: null,
    count: null,
    ordinal: null,
    weekday: null,
    lastDay: false,
  };
}
export function validateSchedule(s) {
  const errors = [];
  if (!s || !["once", "dates", "calendar", "interval"].includes(s.kind))
    return ["Неизвестное расписание"];
  if (s.kind === "dates") {
    if (!s.dates?.length || s.dates.some((v) => !Number.isFinite(dateEpoch(v))))
      errors.push("Выберите даты");
    if (
      !s.times?.length ||
      s.times.some((v) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
    )
      errors.push("Укажите время");
    try {
      parts(new Date(), s.timezoneMode === "fixed" ? s.timezone : zone());
    } catch {
      errors.push("Некорректный часовой пояс");
    }
    return errors;
  }
  if (s.kind === "once")
    return Number.isFinite(new Date(s.at).getTime())
      ? []
      : ["Некорректная дата"];
  if (!Number.isFinite(dateEpoch(s.anchorDate)))
    errors.push("Некорректная опорная дата");
  if (s.kind === "interval") {
    if (!(Number.isInteger(s.intervalMinutes) && s.intervalMinutes >= 1))
      errors.push("Интервал должен быть не меньше минуты");
    if (!Number.isFinite(new Date(s.startAt).getTime()))
      errors.push("Укажите начало интервала");
  } else {
    if (!["daily", "weekly", "monthly", "yearly"].includes(s.frequency))
      errors.push("Неизвестный тип повтора");
    if (!Number.isInteger(+s.interval) || s.interval < 1 || s.interval > 1000)
      errors.push("Некорректный шаг");
    if (
      !s.times?.length ||
      s.times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    )
      errors.push("Укажите время");
    for (const [key, min, max] of [
      ["weekdays", 1, 7],
      ["monthDays", 1, 31],
      ["months", 1, 12],
      ["excludedWeekdays", 1, 7],
    ])
      if (
        (s[key] || []).some((v) => !Number.isInteger(v) || v < min || v > max)
      )
        errors.push(`Некорректный фильтр ${key}`);
    if (s.frequency === "weekly" && !s.weekdays?.length)
      errors.push("Выберите дни недели");
    if (
      s.frequency === "yearly" &&
      (!s.months?.length || (!s.monthDays?.length && !s.lastDay && !s.ordinal))
    )
      errors.push("Для ежегодного повтора нужны месяц и день");
    if (
      s.frequency === "monthly" &&
      !s.monthDays?.length &&
      !s.lastDay &&
      !s.ordinal
    )
      errors.push("Для месяца нужны числа или порядковый день");
    if (
      s.ordinal &&
      (![-1, 1, 2, 3, 4, 5].includes(+s.ordinal) ||
        !s.weekday ||
        s.weekday < 1 ||
        s.weekday > 7)
    )
      errors.push("Некорректный порядковый день");
    if (!["any", "even", "odd"].includes(s.dayParity))
      errors.push("Некорректная чётность");
  }
  if (s.until && !Number.isFinite(dateEpoch(s.until)))
    errors.push("Некорректная дата окончания");
  if (s.count != null && (!Number.isInteger(+s.count) || +s.count < 1))
    errors.push("Количество повторов должно быть положительным");
  if ((s.excludedDates || []).some((d) => !Number.isFinite(dateEpoch(d))))
    errors.push("Некорректная дата исключения");
  try {
    parts(new Date(), s.timezoneMode === "fixed" ? s.timezone : zone());
  } catch {
    errors.push("Некорректный часовой пояс");
  }
  return errors;
}
function matchDay(s, d, anchor) {
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth() + 1,
    n = d.getUTCDate(),
    wd = d.getUTCDay() || 7;
  const days = Math.round((d.getTime() - anchor) / DAY),
    a = new Date(anchor),
    months = (y - a.getUTCFullYear()) * 12 + m - a.getUTCMonth() - 1;
  if (days < 0) return false;
  if (s.months?.length && !s.months.includes(m)) return false;
  if (s.monthDays?.length && !s.monthDays.includes(n)) return false;
  if (s.weekdays?.length && !s.weekdays.includes(wd)) return false;
  if (s.excludedWeekdays?.includes(wd)) return false;
  if (
    (s.dayParity === "even" && n % 2 !== 0) ||
    (s.dayParity === "odd" && n % 2 !== 1)
  )
    return false;
  if (s.lastDay && n !== new Date(Date.UTC(y, m, 0)).getUTCDate()) return false;
  if (s.ordinal) {
    if (wd !== s.weekday) return false;
    if (+s.ordinal === -1) {
      if (new Date(Date.UTC(y, m - 1, n + 7)).getUTCMonth() === m - 1)
        return false;
    } else if (Math.floor((n - 1) / 7) + 1 !== +s.ordinal) return false;
  }
  const step = +s.interval || 1;
  if (s.frequency === "daily" && days % step !== 0) return false;
  if (s.frequency === "weekly") {
    const anchorMonday = anchor - ((a.getUTCDay() || 7) - 1) * DAY,
      week = Math.floor((d.getTime() - anchorMonday) / (7 * DAY));
    if (week % step !== 0) return false;
  }
  if (s.frequency === "monthly" && months % step !== 0) return false;
  if (s.frequency === "yearly" && (y - a.getUTCFullYear()) % step !== 0)
    return false;
  return true;
}
export function nextOccurrences(s, after = Date.now(), limit = 5) {
  if (validateSchedule(s).length) return [];
  if (s.kind === "once") {
    const t = new Date(s.at).getTime();
    return t > after && !s.excludedInstants?.includes(t) ? [t] : [];
  }
  const tz = s.timezoneMode === "fixed" ? s.timezone : zone(),
    out = [],
    until = s.until ? dateEpoch(s.until) : Infinity;
  if (s.kind === "interval") {
    const start = new Date(s.startAt).getTime(),
      ms = s.intervalMinutes * 60000;
    let index = Math.max(0, Math.floor((after - start) / ms) + 1);
    for (let n = 0; n < limit * 1441 && out.length < limit; n++, index++) {
      if (s.count && index >= s.count) break;
      const t = start + index * ms,
        dp = parts(new Date(t), tz),
        ds = localDate(new Date(t), tz);
      if (dateEpoch(ds) > until) break;
      const tm = `${pad(dp.h)}:${pad(dp.min)}`;
      if (
        (s.windowStart && tm < s.windowStart) ||
        (s.windowEnd && tm > s.windowEnd) ||
        s.excludedDates?.includes(ds)
      )
        continue;
      if (!s.excludedInstants?.includes(t)) out.push(t);
    }
    return out;
  }
  if (s.kind === "dates") {
    return [...new Set(s.dates)]
      .flatMap((day) =>
        [...new Set(s.times)].map((time) => zonedTime(day, time, tz)),
      )
      .filter(
        (t) =>
          Number.isFinite(t) &&
          t > after &&
          !s.excludedInstants?.includes(t) &&
          !s.excludedDates?.includes(localDate(new Date(t), tz)),
      )
      .sort((a, b) => a - b)
      .slice(0, limit);
  }
  const anchor = dateEpoch(s.anchorDate),
    start = s.count
      ? anchor
      : Math.max(anchor, dateEpoch(localDate(new Date(after), tz)));
  let emitted = 0;
  // Bounded scan supports leap-year and sparse filters; reject empty intersections in the editor.
  const spanYears =
    s.frequency === "yearly"
      ? Math.max(12, s.interval * (limit + 1))
      : s.frequency === "weekly"
        ? Math.max(12, Math.ceil((s.interval * (limit + 1)) / 52))
        : s.frequency === "monthly"
          ? Math.max(12, Math.ceil((s.interval * (limit + 1)) / 12))
          : 12;
  const boundary =
    dateEpoch(localDate(new Date(after), tz)) + 366 * spanYears * DAY;
  for (let day = start; day < boundary && out.length < limit; day += DAY) {
    if (day > until) break;
    const d = new Date(day),
      ds = d.toISOString().slice(0, 10);
    if (!matchDay(s, d, anchor) || s.excludedDates?.includes(ds)) continue;
    for (const time of [...new Set(s.times)].sort()) {
      const t = zonedTime(ds, time, tz);
      if (
        !Number.isFinite(t) ||
        s.excludedDates?.includes(localDate(new Date(t), tz))
      )
        continue;
      emitted++;
      if (s.count && emitted > s.count) return out;
      if (t > after && !s.excludedInstants?.includes(t)) out.push(t);
      if (out.length === limit) break;
    }
  }
  return out;
}
export const shortTime = (t, tz = zone()) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(t));
export function describe(s) {
  if (s.kind === "dates")
    return `${s.dates.length} дат · ${s.times.join(" · ")}`;
  if (s.kind === "once")
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(s.at));
  if (s.kind === "interval")
    return `Каждые ${s.intervalMinutes} мин${s.windowStart ? " · " + s.windowStart + "–" + s.windowEnd : ""}`;
  const wd = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  let text = {
    daily: +s.interval === 1 ? "Каждый день" : `Раз в ${s.interval} дней`,
    weekly:
      s.weekdays.map((d) => wd[d]).join(", ") +
      (+s.interval > 1 ? ` · каждые ${s.interval} недели` : ""),
    monthly: `${s.monthDays?.join(", ") || ""} числа · каждый ${+s.interval > 1 ? s.interval + "-й " : ""}месяц`,
    yearly: "Каждый год",
  }[s.frequency];
  if (s.ordinal)
    text = `${+s.ordinal === -1 ? "Последний" : s.ordinal + "-й"} ${wd[s.weekday]} месяца`;
  if (s.lastDay) text = "Последний день месяца";
  if (s.dayParity !== "any")
    text +=
      (text === "Каждый день" ? "" : " · ") +
      (s.dayParity === "even" ? "По чётным числам" : "По нечётным числам");
  if (s.dayParity !== "any" && text.startsWith("Каждый день"))
    text = text.replace("Каждый день", "");
  if (s.monthDays?.length && s.frequency !== "monthly")
    text += " · " + s.monthDays.join(", ") + " числа";
  if (s.months?.length) text += " · месяцы " + s.months.join(", ");
  if (s.until) text += " · до " + s.until;
  if (s.count) text += " · " + s.count + " срабатываний";
  return text;
}
