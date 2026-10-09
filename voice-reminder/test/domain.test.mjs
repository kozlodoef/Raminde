import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSchedule,
  nextOccurrences,
  validateSchedule,
  zonedTime,
} from "../src/domain/calendar.js";
import { parseIntent } from "../src/domain/intent.js";
import { isNative } from "../src/lib/native.js";
const now = new Date("2026-10-07T12:30:00Z");
const base = {
  ...defaultSchedule(now),
  kind: "calendar",
  anchorDate: "2026-10-01",
  timezoneMode: "fixed",
  timezone: "UTC",
  times: ["09:00"],
};
const iso = (s, at = now.getTime(), n = 5) =>
  nextOccurrences(s, at, n).map((t) => new Date(t).toISOString());
test("web Capacitor is not native", () => {
  global.window = {
    Capacitor: { getPlatform: () => "web", isNativePlatform: () => false },
  };
  assert.equal(isNative(), false);
  delete global.window;
});
test("android Capacitor is native", () => {
  global.window = { Capacitor: { getPlatform: () => "android" } };
  assert.equal(isNative(), true);
  delete global.window;
});
test("once returns a future instant, not a past instant", () => {
  assert.equal(
    nextOccurrences(
      { ...base, kind: "once", at: "2026-10-08T09:00:00Z" },
      now.getTime(),
      5,
    ).length,
    1,
  );
  assert.equal(
    nextOccurrences(
      { ...base, kind: "once", at: "2020-01-01T00:00:00Z" },
      now.getTime(),
    ).length,
    0,
  );
});
test("daily calendar", () =>
  assert.equal(iso(base)[0], "2026-10-08T09:00:00.000Z"));
test("weekly monday only", () =>
  assert.equal(
    iso({ ...base, frequency: "weekly", weekdays: [1] })[0],
    "2026-10-12T09:00:00.000Z",
  ));
test("weekly multi-selection", () =>
  assert.deepEqual(
    iso(
      { ...base, frequency: "weekly", weekdays: [1, 3, 5] },
      now.getTime(),
      2,
    ),
    ["2026-10-09T09:00:00.000Z", "2026-10-12T09:00:00.000Z"],
  ));
test("biweekly anchors on ISO monday", () =>
  assert.equal(
    iso({
      ...base,
      anchorDate: "2026-10-05",
      frequency: "weekly",
      interval: 2,
      weekdays: [1],
    })[0],
    "2026-10-19T09:00:00.000Z",
  ));
test("monthly dates 8 and 11", () =>
  assert.deepEqual(
    iso(
      { ...base, frequency: "monthly", monthDays: [8, 11] },
      now.getTime(),
      2,
    ),
    ["2026-10-08T09:00:00.000Z", "2026-10-11T09:00:00.000Z"],
  ));
test("missing 31 is skipped", () =>
  assert.equal(
    iso(
      { ...base, frequency: "monthly", monthDays: [31] },
      Date.parse("2026-11-01T00:00:00Z"),
    )[0],
    "2026-12-31T09:00:00.000Z",
  ));
test("last day February", () =>
  assert.equal(
    iso(
      { ...base, frequency: "monthly", lastDay: true },
      Date.parse("2027-02-01T00:00:00Z"),
    )[0],
    "2027-02-28T09:00:00.000Z",
  ));
test("last Friday", () =>
  assert.equal(
    iso({ ...base, frequency: "monthly", ordinal: -1, weekday: 5 })[0],
    "2026-10-30T09:00:00.000Z",
  ));
test("first Monday", () =>
  assert.equal(
    iso({ ...base, frequency: "monthly", ordinal: 1, weekday: 1 })[0],
    "2026-11-02T09:00:00.000Z",
  ));
test("leap day skips non-leap years", () =>
  assert.equal(
    iso({ ...base, frequency: "yearly", months: [2], monthDays: [29] })[0],
    "2028-02-29T09:00:00.000Z",
  ));
test("parity refers to month dates", () =>
  assert.deepEqual(
    iso({ ...base, dayParity: "odd" }, Date.parse("2027-01-30T23:00:00Z"), 2),
    ["2027-01-31T09:00:00.000Z", "2027-02-01T09:00:00.000Z"],
  ));
test("filters are AND", () => {
  const dates = iso({
    ...base,
    weekdays: [1, 2, 3, 4, 5],
    months: [1, 7],
    dayParity: "odd",
  });
  for (const str of dates) {
    const d = new Date(str);
    assert.ok([1, 7].includes(d.getUTCMonth() + 1));
    assert.equal(d.getUTCDate() % 2, 1);
    assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
  }
});
test("deduplicate multiple times", () =>
  assert.equal(
    nextOccurrences(
      { ...base, times: ["09:00", "09:00", "20:00"] },
      Date.parse("2026-10-08T00:00:00Z"),
      2,
    ).length,
    2,
  ));
test("count includes earlier occurrences", () =>
  assert.equal(
    nextOccurrences(
      { ...base, anchorDate: "2026-10-01", count: 2 },
      now.getTime(),
    ).length,
    0,
  ));
test("until inclusive", () =>
  assert.equal(
    nextOccurrences({ ...base, until: "2026-10-08" }, now.getTime()).length,
    1,
  ));
test("excluded date", () =>
  assert.equal(
    iso({ ...base, excludedDates: ["2026-10-08"] })[0],
    "2026-10-09T09:00:00.000Z",
  ));
test("excluded weekday", () =>
  assert.ok(
    !iso({ ...base, excludedWeekdays: [5] }).some(
      (d) => new Date(d).getUTCDay() === 5,
    ),
  ));
test("interval count and window", () =>
  assert.deepEqual(
    iso({
      ...base,
      kind: "interval",
      startAt: "2026-10-08T08:00:00Z",
      intervalMinutes: 60,
      windowStart: "09:00",
      windowEnd: "10:00",
      count: 3,
    }),
    ["2026-10-08T09:00:00.000Z", "2026-10-08T10:00:00.000Z"],
  ));
test("DST gap resolves to next valid wall time", () =>
  assert.equal(
    new Date(zonedTime("2026-03-29", "02:30", "Europe/Berlin")).toISOString(),
    "2026-03-29T01:00:00.000Z",
  ));
test("DST overlap chooses earlier instant", () =>
  assert.equal(
    new Date(zonedTime("2026-10-25", "02:30", "Europe/Berlin")).toISOString(),
    "2026-10-25T00:30:00.000Z",
  ));
test("invalid month day rejected", () =>
  assert.ok(validateSchedule({ ...base, monthDays: [32] }).length));
test("invalid timezone rejected", () =>
  assert.ok(validateSchedule({ ...base, timezone: "not/a/zone" }).length));
test("invalid hour rejected", () =>
  assert.ok(validateSchedule({ ...base, times: ["24:00"] }).length));
test("invalid anchor rejected", () =>
  assert.ok(validateSchedule({ ...base, anchorDate: "2027-02-31" }).length));
test("preserve action preposition", () =>
  assert.equal(
    parseIntent("Напомни завтра в 9 утра позвонить в банк", now).text,
    "Позвонить в банк",
  ));
test("numeric date is not time", () => {
  const r = parseIntent("Напомни 15.10 в 10 утра сдать отчет", now);
  assert.equal(new Date(r.schedule.at).getDate(), 15);
  assert.equal(new Date(r.schedule.at).getHours(), 10);
  assert.equal(r.text, "Сдать отчет");
});
test("invalid real date asks for correction", () =>
  assert.ok(
    parseIntent("Напомни 31 февраля 2027 в 9 утра позвонить врачу", now).issues
      .length,
  ));
test("explicit past today is not shifted silently", () =>
  assert.ok(
    parseIntent("Напомни сегодня в 10 утра принять таблетку", now).issues
      .length,
  ));
test("four AM stays four AM", () =>
  assert.equal(
    new Date(
      parseIntent("Напомни в четыре утра принять таблетку", now).schedule.at,
    ).getHours(),
    4,
  ));
test("recurring Monday phrase", () => {
  const r = parseIntent(
    "Каждый понедельник в 9 утра напомни принять таблетку",
    now,
  );
  assert.equal(r.schedule.kind, "calendar");
  assert.deepEqual(r.schedule.weekdays, [1]);
  assert.equal(r.text, "Принять таблетку");
  assert.deepEqual(r.issues, []);
});
test("recurring dates phrase", () =>
  assert.deepEqual(
    parseIntent("Каждого 8 и 11 числа в 9 утра напомни платить", now).schedule
      .monthDays,
    [8, 11],
  ));
test("parity and months phrase", () => {
  const r = parseIntent(
    "По нечетным дням в январе и июле в 9 утра напомни проверять",
    now,
  );
  assert.equal(r.schedule.dayParity, "odd");
  assert.deepEqual(r.schedule.months, [1, 7]);
  assert.equal(r.text, "Проверять");
});
test("multiple times phrase", () =>
  assert.deepEqual(
    parseIntent("Каждый день в 8 и 20 напомни пить воду", now).schedule.times,
    ["08:00", "20:00"],
  ));
test("missing time needs manual confirmation", () =>
  assert.ok(parseIntent("Напомни позвонить врачу", now).issues.length));
test("skip a single occurrence preserves series", () => {
  const t = nextOccurrences(base, now.getTime(), 1)[0];
  assert.equal(
    iso({ ...base, excludedInstants: [t] })[0],
    "2026-10-09T09:00:00.000Z",
  );
});
test("long-lived counted series still has future dates", () => {
  const s = { ...base, anchorDate: "2000-01-01", count: 20000 };
  assert.equal(iso(s)[0], "2026-10-08T09:00:00.000Z");
});
test("action retains proper names and ё", () => {
  assert.equal(
    parseIntent("Напомни завтра в 9 утра позвонить Лёне", now).text,
    "Позвонить Лёне",
  );
});
