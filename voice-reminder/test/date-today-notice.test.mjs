import test from "node:test";
import assert from "node:assert/strict";

import { parseEditor } from "../src/domain/home-editor.js";
import { buildGroup, spokenDateKind } from "../src/domain/groups.js";
import { dateNote } from "../src/domain/draft-model.js";

const NOW = new Date("2026-11-24T10:00:00");
const FREE = { dates: false };
const PAID = { dates: true };

/** Разбирает фразу и собирает расписание. */
function run(phrase, options, selectedDates = [], now = NOW) {
  const draft = parseEditor(phrase, { selectedDates }, now, options);
  const schedule = buildGroup(
    { ...draft, text: draft.text || "" },
    now.getTime(),
    {},
  ).schedule;
  return { draft, schedule };
}

test("бесплатная версия: «завтра» не переносит напоминание на завтра", () => {
  const { schedule } = run("завтра в 20:00 полить цветы", FREE);
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
});

test("бесплатная версия: «послезавтра» не переносит напоминание", () => {
  const { schedule } = run("послезавтра в 21:00 позвонить", FREE);
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
});

test("бесплатная версия: названное «завтра» запоминается", () => {
  const { draft } = run("завтра в 20:00 полить цветы", FREE);
  assert.equal(draft.spokenDateWord, "tomorrow");
});

test("бесплатная версия: названное «послезавтра» запоминается", () => {
  const { draft } = run("послезавтра в 21:00 позвонить", FREE);
  assert.equal(draft.spokenDateWord, "afterTomorrow");
});

test("бесплатная версия: «сегодня» даёт сегодняшнюю дату", () => {
  const { draft, schedule } = run("сегодня в 18:00 ужин", FREE);
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
  assert.equal(draft.spokenDateWord, "today");
});

test("бесплатная версия: без слова даты — тоже сегодня", () => {
  const { draft, schedule } = run("купить хлеб в обед", FREE);
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
  assert.equal(draft.spokenDateWord, null);
});

test("бесплатная версия: отмеченная дата важнее сказанного слова", () => {
  const { schedule } = run("завтра в 20:00 полить", FREE, ["2026-12-05"]);
  assert.deepEqual(schedule.dates, ["2026-12-05"]);
});

// --- Сообщение о том, на какую дату записали ---

test("сообщение про сегодня появляется, если дату не выбирали", () => {
  const { draft } = run("купить хлеб в обед", FREE);
  assert.equal(dateNote(draft), "Напоминание записано на сегодня.");
});

test("сказанное «сегодня» даёт то же сообщение", () => {
  const { draft } = run("сегодня в 18:00 ужин", FREE);
  assert.equal(dateNote(draft), "Напоминание записано на сегодня.");
});

test("сообщение про сегодня предлагает календарь, если сказали «завтра»", () => {
  const { draft } = run("завтра в 20:00 полить", FREE);
  const note = dateNote(draft);
  assert.match(note, /записано на сегодня/);
  assert.match(note, /календаре/);
});

test("сообщения нет, если дату отметили на календаре", () => {
  const { draft } = run("в 20:00 полить", FREE, ["2026-12-05"]);
  assert.equal(dateNote(draft), "");
});

// --- Платная версия работает как раньше ---

test("ПРО: «завтра» даёт завтрашнюю дату", () => {
  const { schedule } = run("завтра в 20:00 полить цветы", PAID);
  assert.deepEqual(schedule.dates, ["2026-11-25"]);
});

test("ПРО: «послезавтра» даёт послезавтрашнюю дату", () => {
  const { schedule } = run("послезавтра в 21:00 позвонить", PAID);
  assert.deepEqual(schedule.dates, ["2026-11-26"]);
});

// --- Определение слова даты ---

test("spokenDateKind различает слова и не путает «завтра» с «послезавтра»", () => {
  assert.equal(spokenDateKind("завтра полить цветы"), "tomorrow");
  assert.equal(spokenDateKind("послезавтра позвонить"), "afterTomorrow");
  assert.equal(spokenDateKind("сегодня ужин"), "today");
  assert.equal(spokenDateKind("полить цветы"), null);
  assert.equal(spokenDateKind(""), null);
});

test("spokenDateKind не срабатывает внутри другого слова", () => {
  // «завтрак» содержит «завтра», но датой не является.
  assert.equal(spokenDateKind("приготовить завтрак"), null);
});
