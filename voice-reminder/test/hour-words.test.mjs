import test from "node:test";
import assert from "node:assert/strict";

import { parseEditor } from "../src/domain/home-editor.js";
import { buildGroup } from "../src/domain/groups.js";
import { toDigits } from "../src/domain/phrase-digits.js";

// Раннее утро: все времена суток ещё впереди, поэтому проверяется разбор,
// а не жалоба «время уже прошло».
const NOW = new Date("2026-11-24T05:00:00");
const FREE = { dates: false };

/** Время, которое получится из фразы. */
function times(phrase, options = FREE) {
  const draft = parseEditor(phrase, { selectedDates: [] }, NOW, options);
  const schedule = buildGroup(
    { ...draft, text: draft.text || "" },
    NOW.getTime(),
    {},
  ).schedule;
  return { times: schedule.times, text: draft.text };
}

test("«восемнадцать часов» распознаётся без предлога", () => {
  assert.deepEqual(times("восемнадцать часов полить цветы").times, ["18:00"]);
});

test("«восемнадцать часов» с предлогом тоже работает", () => {
  assert.deepEqual(times("в восемнадцать часов полить цветы").times, ["18:00"]);
});

test("слово «часов» не попадает в текст напоминания", () => {
  assert.equal(times("восемнадцать часов полить цветы").text, "Полить цветы");
});

test("«в девятнадцать часов тридцать минут» даёт половину", () => {
  assert.deepEqual(
    times("в девятнадцать часов тридцать минут позвонить").times,
    ["19:30"],
  );
});

test("«восемь часов утра» учитывает часть дня", () => {
  assert.deepEqual(times("восемь часов утра зарядка").times, ["08:00"]);
});

test("«двадцать один час» — это 21:00", () => {
  assert.deepEqual(times("двадцать один час позвонить").times, ["21:00"]);
});

test("часы цифрами без предлога распознаются", () => {
  assert.deepEqual(times("18 часов полить цветы").times, ["18:00"]);
});

test("«через два часа» остаётся отсчётом, а не временем суток", () => {
  // Отсчёт от 05:00 даёт 07:00 — это «через два часа», а не 02:00.
  assert.deepEqual(times("через два часа полить цветы").times, ["07:00"]);
});

test("«каждые два часа» — повтор, а не время суток", () => {
  const draft = parseEditor(
    "каждые два часа пить воду",
    { selectedDates: [] },
    NOW,
    FREE,
  );
  const schedule = buildGroup(
    { ...draft, text: draft.text || "" },
    NOW.getTime(),
    {},
  ).schedule;
  assert.equal(schedule.intervalMinutes, 120);
  assert.equal(draft.text, "Пить воду");
});

test("«купить 2 хлеба» не превращается во время", () => {
  const draft = parseEditor(
    "купить 2 хлеба",
    { selectedDates: [] },
    NOW,
    FREE,
  );
  assert.deepEqual(draft.times || [], []);
  assert.equal(draft.text, "Купить 2 хлеба");
  // Время не найдено — сборка расписания должна об этом сказать, а не
  // подставить 02:00 из числа «2».
  assert.throws(() => buildGroup(draft, NOW.getTime()), /сколько|время/i);
});

// --- Поле ввода показывает время цифрами ---

/** Что человек видит в поле ввода. */
function shown(phrase) {
  const draft = parseEditor(phrase, { selectedDates: [] }, NOW, FREE);
  return toDigits(phrase, draft, NOW);
}

test("«восемнадцать часов» показывается цифрами", () => {
  assert.equal(shown("восемнадцать часов полить цветы"), "18:00 полить цветы");
});

test("«восемь часов утра» показывается цифрами", () => {
  assert.equal(shown("восемь часов утра зарядка"), "08:00 зарядка");
});

test("часы и минуты словами показываются как 19:30", () => {
  assert.equal(
    shown("в девятнадцать часов тридцать минут позвонить маме"),
    "в 19:30 позвонить маме",
  );
});

test("«через два часа» остаётся отсчётом в поле ввода", () => {
  assert.equal(shown("через два часа полить цветы"), "через 2 ч полить цветы");
});

test("«каждые два часа» не превращается в 02:00 в поле ввода", () => {
  assert.equal(shown("каждые два часа пить воду"), "каждые два часа пить воду");
});
