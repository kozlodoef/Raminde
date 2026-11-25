import test from "node:test";
import assert from "node:assert/strict";

import { toggleEditorDate } from "../src/domain/home-editor.js";
import { assertDailyCapacity } from "../src/domain/day-capacity.js";
import {
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

// --- Несколько дат на событие доступны всем ---
//
// Раньше в бесплатной версии можно было отметить только одну дату, и это
// было единственным ограничением вместе с дневным лимитом. Ограничение
// снято: несколько дат на событие доступны без подписки.

test("вторая дата выбирается без подписки", () => {
  const first = toggleEditorDate({ selectedDates: [] }, "2026-12-01").draft;
  const r = toggleEditorDate(first, "2026-12-02");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-01", "2026-12-02"]);
});

test("третья и последующие даты тоже выбираются", () => {
  let draft = { selectedDates: [] };
  for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"])
    draft = toggleEditorDate(draft, d).draft;
  assert.deepEqual(draft.selectedDates, [
    "2026-12-01",
    "2026-12-02",
    "2026-12-03",
  ]);
});

test("выбранную дату можно снять", () => {
  const r = toggleEditorDate({ selectedDates: ["2026-12-01"] }, "2026-12-01");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, []);
});

test("после снятия можно выбрать другую", () => {
  const cleared = toggleEditorDate(
    { selectedDates: ["2026-12-01"] },
    "2026-12-01",
  ).draft;
  const r = toggleEditorDate(cleared, "2026-12-05");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.draft.selectedDates, ["2026-12-05"]);
});

// --- Предел на день ---
//
// Лимит «три напоминания в день» снят: он мешал в обычный плотный день.
// Осталась только техническая граница — 24 (по числу часов в сутках).

test("пять напоминаний в день проходят", () => {
  const existing = [
    reminder("a", "2026-12-01", ["09:00"]),
    reminder("b", "2026-12-01", ["11:00"]),
    reminder("c", "2026-12-01", ["13:00"]),
    reminder("d", "2026-12-01", ["15:00"]),
  ];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("e", "2026-12-01", ["17:00"])]),
  );
});

test("двадцать четыре напоминания в день проходят", () => {
  const times = Array.from({ length: 23 }, (_, i) =>
    String(i).padStart(2, "0") + ":00",
  );
  const existing = [reminder("a", "2026-12-01", times)];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("b", "2026-12-01", ["23:00"])]),
  );
});

test("двадцать пятое напоминание в день отклоняется", () => {
  const times = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0") + ":00",
  );
  assert.throws(
    () =>
      assertDailyCapacity([reminder("a", "2026-12-01", times)], [
        reminder("b", "2026-12-02", ["08:00"]),
        reminder("c", "2026-12-01", ["23:59"]),
      ]),
    /напоминаний/,
  );
});

test("в сообщении нет упоминания версии", () => {
  // Одна цель: человек видит, что предел технический, а не «купите ПРО».
  const times = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0") + ":00",
  );
  try {
    assertDailyCapacity([reminder("a", "2026-12-01", times)], [
      reminder("c", "2026-12-01", ["23:59"]),
    ]);
    assert.fail("должно было отклонить");
  } catch (e) {
    assert.ok(!/ПРО/i.test(e.message), "упоминание ПРО осталось: " + e.message);
    assert.match(e.message, /Максимум — 24/);
  }
});

test("лимит считается по дням отдельно", () => {
  const times = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0") + ":00",
  );
  const existing = [reminder("a", "2026-12-01", times)];
  assert.doesNotThrow(() =>
    assertDailyCapacity(existing, [reminder("d", "2026-12-02", ["09:00"])]),
  );
});

test("несколько времён в одном напоминании считаются отдельными событиями", () => {
  // 24 времени в одном правиле уже занимают весь день; ещё одно — перебор.
  const times = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0") + ":00",
  );
  const existing = [reminder("a", "2026-12-01", times)];
  assert.throws(
    () => assertDailyCapacity(existing, [reminder("b", "2026-12-01", ["23:30"])]),
    /напоминаний/,
  );
});

// --- Признак версии ---

test("признак ПРО берётся из ответа платёжного сервера", () => {
  assert.equal(isPro({ premium: true }), true);
  assert.equal(isPro({ premium: false }), false);
  assert.equal(isPro(null), false);
});

test("даты из речи доступны всем — это больше не возможность ПРО", () => {
  // Было: dateSpeechEnabled(bill) давал true только с подпиской, и без неё
  // «двадцать пятого декабря» уходило в текст, а напоминание срабатывало
  // сегодня. Теперь разбор дат включён всегда.
  assert.equal(dateSpeechEnabled({ premium: true }), true);
  assert.equal(dateSpeechEnabled(undefined), true);
  assert.equal(dateSpeechEnabled(null), true);
});
