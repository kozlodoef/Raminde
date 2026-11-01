import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGroup,
  buildGroup,
  occurrencesInMonth,
} from "../src/domain/groups.js";
import {
  nextOccurrences,
  defaultSchedule,
  validateSchedule,
} from "../src/domain/calendar.js";
import { trialAccess, accessActive, addMonth } from "../src/domain/access.js";
const now = new Date("2026-10-07T06:00:00Z");
const base = {
  ...defaultSchedule(now),
  kind: "dates",
  timezoneMode: "fixed",
  timezone: "UTC",
  dates: ["2026-10-08", "2026-10-11"],
  times: ["09:00", "11:00", "20:00"],
};
test("two calendar days and three times yield six ordered occurrences", () => {
  const v = nextOccurrences(base, now.getTime(), 10);
  assert.equal(v.length, 6);
  assert.deepEqual(
    v.map((t) => new Date(t).toISOString()),
    [
      "2026-10-08T09:00:00.000Z",
      "2026-10-08T11:00:00.000Z",
      "2026-10-08T20:00:00.000Z",
      "2026-10-11T09:00:00.000Z",
      "2026-10-11T11:00:00.000Z",
      "2026-10-11T20:00:00.000Z",
    ],
  );
});
test("duplicates do not duplicate events", () =>
  assert.equal(
    nextOccurrences(
      {
        ...base,
        dates: [...base.dates, base.dates[0]],
        times: [...base.times, "09:00"],
      },
      now.getTime(),
      10,
    ).length,
    6,
  ));
test("skip only one occurrence", () => {
  const t = nextOccurrences(base, now.getTime(), 1)[0];
  assert.equal(
    nextOccurrences({ ...base, excludedInstants: [t] }, now.getTime(), 10)
      .length,
    5,
  );
});
test("group shares one color in agenda", () => {
  const e = occurrencesInMonth(
    [
      {
        id: "group",
        text: "Таблетка",
        enabled: true,
        color: "#123456",
        schedule: base,
      },
    ],
    "2026-10",
  );
  assert.equal(e.length, 6);
  assert.ok(e.every((v) => v.color === "#123456"));
});
test("Russian spoken three times, preserve calendar dates", () => {
  const p = parseGroup(
    "Напомни принять таблетку в девять утра, в одиннадцать и в восемь вечера",
    base.dates,
    now,
  );
  assert.deepEqual(p.times, ["09:00", "11:00", "20:00"]);
  assert.equal(p.text, "Принять таблетку");
  assert.deepEqual(p.dates, base.dates);
});
test("numeric list times", () =>
  assert.deepEqual(
    parseGroup("Принять таблетку в 9, 11 и 20", base.dates, now).times,
    ["09:00", "11:00", "20:00"],
  ));
test("calendar conflict is never silently replaced", () =>
  assert.ok(
    parseGroup("Завтра в 9 купить хлеб", ["2026-10-11"], now).dateConflict,
  ));
test("no dates means today", () =>
  assert.deepEqual(
    parseGroup("В 20 часов позвонить маме", [], now).schedule.dates,
    ["2026-10-07"],
  ));
test("past times cannot be silently shifted", () =>
  assert.throws(
    () =>
      buildGroup(
        { text: "x", dates: ["2026-10-06"], times: ["09:00"] },
        now.getTime(),
      ),
    /прошла/,
  ));
test("missing time cannot save", () =>
  assert.throws(
    () =>
      buildGroup({ text: "x", dates: base.dates, times: [] }, now.getTime()),
    /время/,
  ));
test("invalid explicit date rejected", () =>
  assert.ok(validateSchedule({ ...base, dates: ["2026-02-30"] }).length));
test("recurring multiple times are not flattened into one month", () => {
  const p = parseGroup("Каждый понедельник в 9 и 20 принять таблетку", [], now);
  assert.equal(p.schedule.kind, "calendar");
  assert.deepEqual(p.schedule.times, ["09:00", "20:00"]);
});
test("preserve proper names", () =>
  assert.match(parseGroup("В 20 позвонить Петру", [], now).text, /Петру/));
test("month trial is clamped on Jan 31", () =>
  assert.equal(
    new Date(addMonth(Date.parse("2027-01-31T12:00:00Z"))).toISOString(),
    "2027-02-28T12:00:00.000Z",
  ));
test("trial is initialized once and ends at exact boundary", () => {
  const a = trialAccess(null, now.getTime());
  assert.equal(
    trialAccess(a, now.getTime() + 1000).trialStartedAt,
    a.trialStartedAt,
  );
  assert.equal(accessActive(a, a.trialEndsAt - 1), true);
  assert.equal(accessActive(a, a.trialEndsAt), false);
});
test("spoken hours do not leak into action", () =>
  assert.equal(
    parseGroup("В девять часов утра позвонить Петру", [], now).text,
    "Позвонить Петру",
  ));
test("self-correction chooses the corrected time", () =>
  assert.deepEqual(
    parseGroup("Напомни в девять, нет в одиннадцать принять таблетку", [], now)
      .times,
    ["11:00"],
  ));
test("different scoped events cannot silently become a cross product", () =>
  assert.ok(
    parseGroup("В 9 подъём, в 11 завтрак", [], now).issues.some((e) =>
      e.includes("по очереди"),
    ),
  ));

test("implicit today is not an explicit selection after dictation", () =>
  assert.deepEqual(parseGroup("Принять таблетку в 20", [], now).dates, []));
test("expired access blocks new creation but allows pausing saved reminders", async () => {
  const map = new Map();
  global.localStorage = {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
  };
  try {
    const r = await import("../src/domain/repository.js");
    const access = trialAccess(null, Date.now() - 80 * 86400000);
    const saved = {
      id: "saved",
      text: "Не отключать",
      enabled: true,
      schedule: { ...base, dates: ["2099-10-08"] },
      createdAt: Date.now() - 1000,
    };
    map.set(
      "raminde.v2",
      JSON.stringify({ ...r.emptyState(), access, reminders: [saved] }),
    );
    await assert.rejects(
      r.putReminder({ ...saved, id: "new" }),
      /SUBSCRIPTION/,
    );
    const paused = await r.putReminder({ ...saved, enabled: false });
    assert.equal(paused.reminders[0].enabled, false);
    assert.equal(paused.access.trialStartedAt, access.trialStartedAt);
  } finally {
    delete global.localStorage;
  }
});
test("a queued draft cannot use createdAt to silently skip past selected times", () =>
  assert.throws(
    () =>
      buildGroup(
        {
          text: "Таблетка",
          createdAt: now.getTime() - 1000,
          dates: ["2026-10-06", "2026-10-08"],
          times: ["09:00"],
        },
        now.getTime(),
      ),
    /прошла/,
  ));
test("an explicitly edited existing group can preserve its historical dates", () =>
  assert.ok(
    buildGroup(
      {
        text: "Таблетка",
        dates: ["2026-10-06", "2026-10-08"],
        times: ["09:00"],
      },
      now.getTime(),
      { allowPast: true },
    ).schedule,
  ));
