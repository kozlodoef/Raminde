import test from "node:test";
import assert from "node:assert/strict";

import { toggleEditorDate } from "../src/domain/home-editor.js";
import { assertDailyCapacity } from "../src/domain/day-capacity.js";
import {
  FREE_DATES_PER_EVENT,
  FREE_REMINDERS_PER_DAY,
  isPro,
  dateSpeechEnabled,
} from "../src/domain/access.js";

const NOW = Date.now();

/** Напоминание на конкретную дату. */
function reminder(id, date, times = ["10:00"]) {
  return {
    id,
    text: "напоминание " + id,
    enabled: true,
    createdAt: NOW,
    schedule: { kind: "dates", dates: [date], times, timezoneMode: "floating" },
  };
}

// --- Одна дата на событие в бесплатной версии ---

test("бесплатная версия: первая дата выбирается", () => {
  const r = toggleEditorDate({ selectedDates: [] }, "2026-12-01", {
    maxDates: FREE_DATES_PER_EVENT,
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-01"]);
});

test("бесплатная версия: вторая дата отклоняется", () => {
  const r = toggleEditorDate({ selectedDates: ["2026-12-01"] }, "2026-12-02", {
    maxDates: FREE_DATES_PER_EVENT,
  });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-01"]);
});

test("бесплатная версия: выбранную дату можно снять", () => {
  const r = toggleEditorDate({ selectedDates: ["2026-12-01"] }, "2026-12-01", {
    maxDates: FREE_DATES_PER_EVENT,
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, []);
});

test("бесплатная версия: после снятия можно выбрать другую", () => {
  const cleared = toggleEditorDate(
    { selectedDates: ["2026-12-01"] },
    "2026-12-01",
    { maxDates: FREE_DATES_PER_EVENT },
  ).draft;
  const r = toggleEditorDate(cleared, "2026-12-05", {
    maxDates: FREE_DATES_PER_EVENT,
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-05"]);
});

test("ПРО: несколько дат разрешены", () => {
  const first = toggleEditorDate({ selectedDates: [] }, "2026-12-01").draft;
  const r = toggleEditorDate(first, "2026-12-02");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-01", "2026-12-02"]);
});

// --- Не больше трёх напоминаний в день в бесплатной версии ---

test("бесплатная версия: три напоминания в день проходят", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["12:00"]),
  ];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("c", "2026-12-01", ["15:00"])], {
      maxPerDay: FREE_REMINDERS_PER_DAY,
    }),
  );
});

test("бесплатная версия: четвёртое напоминание в день отклоняется", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["12:00"]),
    reminder("c", "2026-12-01", ["15:00"]),
  ];
  assert.throws(
    () =>
      assertDailyCapacity(existing, [reminder("d", "2026-12-01", ["18:00"])], {
        maxPerDay: FREE_REMINDERS_PER_DAY,
      }),
    /ПРО-версии/,
  );
});

test("сообщение об ограничении говорит про ПРО-версию", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["12:00"]),
    reminder("c", "2026-12-01", ["15:00"]),
  ];
  try {
    assertDailyCapacity(existing, [reminder("d", "2026-12-01", ["18:00"])], {
      maxPerDay: FREE_REMINDERS_PER_DAY,
    });
    assert.fail("должно было отклонить");
  } catch (e) {
    assert.match(e.message, /не больше 3 в день/);
    assert.match(e.message, /ПРО-версии/);
  }
});

test("ПРО: четвёртое напоминание в день проходит", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["12:00"]),
    reminder("c", "2026-12-01", ["15:00"]),
  ];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("d", "2026-12-01", ["18:00"])]),
  );
});

test("лимит считается по дням отдельно", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["12:00"]),
    reminder("c", "2026-12-01", ["15:00"]),
  ];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("d", "2026-12-02", ["09:00"])], {
      maxPerDay: FREE_REMINDERS_PER_DAY,
    }),
  );
});

test("несколько времён в одном напоминании считаются отдельными событиями", () => {
  const existing = [reminder("a", "2026-12-01", ["09:00", "12:00", "15:00"])];
  assert.throws(
    () =>
      assertDailyCapacity(existing, [reminder("b", "2026-12-01", ["18:00"])], {
        maxPerDay: FREE_REMINDERS_PER_DAY,
      }),
    /ПРО-версии/,
  );
});

// --- Признак версии ---

test("признак ПРО берётся из ответа платёжного сервера", () => {
  assert.equal(isPro({ premium: true }), true);
  assert.equal(isPro({ premium: false }), false);
  assert.equal(isPro(null), false);
  assert.equal(dateSpeechEnabled({ premium: true }), true);
  assert.equal(dateSpeechEnabled(undefined), false);
});
