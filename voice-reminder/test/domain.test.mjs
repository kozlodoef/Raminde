import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSchedule,
  nextOccurrences,
  validateSchedule,
  zonedTime,
} from "../src/domain/calendar.js";
import { parseIntent, parseIntents, splitIntentPhrases } from "../src/domain/intent.js";
import { isNative } from "../src/lib/native.js";
import {
  issuesAfterDraftChange,
  unresolvedDraftIssues,
  unresolvedDraftMessage,
} from "../src/domain/draftValidation.js";
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

test("spoken hour and minute are persisted in the parsed schedule", () => {
  const now = new Date("2026-10-07T12:30:00Z");
  for (const [phrase, expected] of [
    ["Напомни в 08:15 позвонить", "08:15"],
    ["Напомни в 09:00 позвонить", "09:00"],
    ["Напомни в 14:30 позвонить", "14:30"],
    ["Напомни в 21:45 позвонить", "21:45"],
    ["Напомни в восемь пятнадцать позвонить", "08:15"],
    ["Напомни в двадцать один сорок пять позвонить", "21:45"],
  ]) {
    const parsed = parseIntent(phrase, now);
    assert.equal(parsed.issues.length, 0, phrase);
    assert.equal(new Date(parsed.schedule.at).getHours(), Number(expected.slice(0, 2)), phrase);
    assert.equal(new Date(parsed.schedule.at).getMinutes(), Number(expected.slice(3)), phrase);
  }
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

test("recurring spoken time survives scheduling across midnight", () => {
  const parsed = parseIntent("Каждый день в 21:45 пить воду", new Date("2026-10-07T23:50:00Z"));
  parsed.schedule.timezoneMode = "fixed";
  parsed.schedule.timezone = "UTC";
  assert.equal(parsed.schedule.times[0], "21:45");
  assert.equal(new Date(nextOccurrences(parsed.schedule, Date.parse("2026-10-08T00:00:00Z"), 1)[0]).toISOString(), "2026-10-08T21:45:00.000Z");
});
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
test("independent voice clauses become separate reminders", () => {
  const phrase = "Напомни завтра в 9 позвонить маме и завтра в 10 купить хлеб";
  assert.deepEqual(splitIntentPhrases(phrase), [
    "Напомни завтра в 9 позвонить маме",
    "завтра в 10 купить хлеб",
  ]);
  const parsed = parseIntents(phrase, now);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].text, "Позвонить маме");
  assert.equal(parsed[1].text, "Купить хлеб");
  assert.equal(new Date(parsed[0].schedule.at).getHours(), 9);
  assert.equal(new Date(parsed[1].schedule.at).getHours(), 10);
});
test("independent clauses can use a bare second time", () => {
  const parsed = parseIntents("Напомни завтра в 9 позвонить маме и в 10 купить хлеб", now);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].text, "Купить хлеб");
  assert.equal(new Date(parsed[1].schedule.at).getHours(), 10);
});
test("multiple times in one recurring rule stay one reminder", () => {
  assert.equal(
    parseIntents("Каждый день в 8 и 20 напомни пить воду", now).length,
    1,
  );
});
test("several explicitly named dates stay a finite date set", () => {
  const r = parseIntents(
    "Напомни 15 и 20 октября в 10 позвонить врачу",
    now,
  )[0];
  assert.equal(r.text, "Позвонить врачу");
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.schedule.specificDates, ["2026-10-15", "2026-10-20"]);
  assert.deepEqual(
    iso(r.schedule, 10).slice(0, 2),
    ["2026-10-15T06:00:00.000Z", "2026-10-20T06:00:00.000Z"],
  );
});
test("dateFound distinguishes spoken dates from time-only phrases", () => {
  assert.equal(parseIntents("Напомни 15 октября в 10 позвонить врачу", now)[0].dateFound, true);
  assert.equal(parseIntents("Напомни в 10 позвонить врачу", now)[0].dateFound, false);
});
test("invalid date in a finite date set asks for correction", () => {
  const r = parseIntents(
    "Напомни 31 февраля 2027 и 20 марта 2027 в 10 позвонить врачу",
    now,
  )[0];
  assert.ok(r.issues.some((issue) => issue.includes("несуществующая дата")));
});
test("invalid day in a finite date set asks for correction", () => {
  const r = parseIntents(
    "Напомни 0 марта и 20 марта в 10 позвонить врачу",
    now,
  )[0];
  assert.ok(r.issues.some((issue) => issue.includes("несуществующая дата")));
});
test("invalid finite date blocks the draft save gate", () => {
  const r = parseIntents(
    "Напомни 31 февраля 2027 и 15 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.deepEqual(r.schedule.specificDates, ["2027-03-15"]);
  assert.match(unresolvedDraftMessage(r.issues), /Исправьте.*несуществующ/);
});
test("valid finite dates have no save-blocking issues", () => {
  const r = parseIntents(
    "Напомни 15 и 20 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.deepEqual(r.schedule.specificDates, ["2027-03-15", "2027-03-20"]);
  assert.deepEqual(unresolvedDraftIssues(r.issues), []);
  assert.equal(unresolvedDraftMessage(r.issues), "");
});
test("day zero remains blocked until the draft is corrected", () => {
  const r = parseIntents(
    "Напомни 0 марта и 20 марта в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.match(unresolvedDraftMessage(r.issues), /Исправьте.*несуществующ/);
});
test("correcting the date list clears the save block", () => {
  const invalid = parseIntents(
    "Напомни 31 февраля 2027 и 15 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  const corrected = parseIntents(
    "Напомни 28 февраля 2027 и 15 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.notEqual(unresolvedDraftMessage(invalid.issues), "");
  assert.deepEqual(corrected.issues, []);
  assert.equal(unresolvedDraftMessage(corrected.issues), "");
});
test("an invalid edit cannot replace an existing finite date rule", () => {
  const existing = parseIntents(
    "Напомни 15 и 20 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  const invalidEdit = parseIntents(
    "Напомни 31 февраля 2027 и 15 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.equal(unresolvedDraftMessage(invalidEdit.issues).startsWith("Исправьте:"), true);
  assert.deepEqual(existing.schedule.specificDates, ["2027-03-15", "2027-03-20"]);
});
test("time or text edits retain an invalid date issue", () => {
  const issues = ["В списке есть несуществующая дата — исправьте даты"];
  assert.deepEqual(issuesAfterDraftChange(issues, { times: ["11:00"] }), issues);
  assert.deepEqual(issuesAfterDraftChange(issues, { text: "Другое" }), issues);
});
test("editing the date list releases a corrected date issue", () => {
  const issues = ["В списке есть несуществующая дата — исправьте даты"];
  assert.deepEqual(
    issuesAfterDraftChange(issues, { specificDates: ["2027-02-28", "2027-03-15"] }),
    [],
  );
});
test("editing a one-time date releases its invalid date issue", () => {
  const issues = ["Такой даты не существует"];
  assert.deepEqual(
    issuesAfterDraftChange(issues, { at: "2027-02-28T10:00:00.000Z" }),
    [],
  );
});
test("other schedule edits retain the invalid date issue", () => {
  const issues = [
    "В списке есть несуществующая дата — исправьте даты",
    "Уточните время напоминания",
  ];
  assert.deepEqual(issuesAfterDraftChange(issues, { interval: 2 }), [
    "В списке есть несуществующая дата — исправьте даты",
  ]);
});
test("editing time clears other issues but retains an invalid date issue", () => {
  const issues = [
    "В списке есть несуществующая дата — исправьте даты",
    "Уточните время напоминания",
  ];
  assert.deepEqual(issuesAfterDraftChange(issues, { times: ["10:00"] }), [
    "В списке есть несуществующая дата — исправьте даты",
  ]);
});
