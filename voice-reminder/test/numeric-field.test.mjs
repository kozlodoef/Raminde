// Числовые поля настроек: их должно быть можно очистить.
//
// Дефект: поле «Интервал повторов, минут» содержало 5, и стереть эту цифру
// было нельзя. Значение уходило в настройки сразу при вводе: человек стирал
// «5», приходило пустое, разбор давал 0, проверка «больше нуля» не проходила
// — состояние оставалось прежним, и React возвращал в поле «5».
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNumericInput,
  numericFieldValue,
  dropDraft,
} from "../src/lib/numeric-field.js";

// --- Разбор ввода ---

test("пустое поле — промежуточное состояние, а не ноль", () => {
  const r = parseNumericInput("", { min: 1 });
  assert.equal(r.empty, true);
  assert.equal(r.value, null);
  assert.equal(r.invalid, false);
});

test("пробелы вокруг числа не мешают", () => {
  assert.equal(parseNumericInput("  15  ", { min: 1 }).value, 15);
});

test("положительное целое принимается", () => {
  for (const [raw, want] of [["1", 1], ["5", 5], ["30", 30], ["120", 120]])
    assert.equal(parseNumericInput(raw, { min: 1 }).value, want, "ввод: " + raw);
});

test("ноль принимается там, где он разрешён", () => {
  // «Максимум попыток: 0 — без ограничения».
  assert.equal(parseNumericInput("0", { min: 0 }).value, 0);
  // А интервал повторов нулём быть не может.
  assert.equal(parseNumericInput("0", { min: 1 }).value, null);
  assert.equal(parseNumericInput("0", { min: 1 }).invalid, true);
});

test("нечисло отклоняется, но не считается пустотой", () => {
  const r = parseNumericInput("abc", { min: 1 });
  assert.equal(r.invalid, true);
  assert.equal(r.empty, false);
  assert.equal(r.value, null);
});

test("дробное отклоняется: минуты и попытки целые", () => {
  assert.equal(parseNumericInput("2.5", { min: 1 }).value, null);
});

test("запятая понимается как разделитель", () => {
  // На русской клавиатуре запятую набирают чаще точки. «2,5» — всё равно
  // дробное, но разбор не должен падать на запятой.
  const r = parseNumericInput("2,5", { min: 1 });
  assert.equal(r.value, null);
  assert.equal(r.invalid, true);
});

test("верхняя граница соблюдается", () => {
  assert.equal(parseNumericInput("99", { min: 0, max: 99 }).value, 99);
  assert.equal(parseNumericInput("100", { min: 0, max: 99 }).value, null);
});

// --- Что показывать в поле ---

test("пока черновик есть, поле показывает его — даже пустым", () => {
  // Это и есть исправление: стёрли «5» — в поле пусто, а не «5».
  assert.equal(numericFieldValue("", 5), "");
  assert.equal(numericFieldValue("1", 5), "1");
});

test("без черновика показывается сохранённое значение", () => {
  assert.equal(numericFieldValue(undefined, 5), "5");
  assert.equal(numericFieldValue(null, 5), "5");
});

test("негодное сохранённое значение не печатается как есть", () => {
  assert.equal(numericFieldValue(undefined, NaN), "");
  assert.equal(numericFieldValue(undefined, undefined), "");
});

// --- Сброс черновика ---

test("уход из поля возвращает показ сохранённого значения", () => {
  const drafts = { repeatMinutes: "", maxAttempts: "3" };
  const next = dropDraft(drafts, "repeatMinutes");
  assert.equal("repeatMinutes" in next, false);
  assert.equal(next.maxAttempts, "3", "чужое поле не должно пострадать");
});

test("сброс несуществующего поля ничего не ломает", () => {
  const drafts = { a: "1" };
  assert.deepEqual(dropDraft(drafts, "b"), { a: "1" });
  assert.equal(dropDraft(null, "a"), null);
  assert.equal(dropDraft(undefined, "a"), undefined);
});

// --- Сценарий целиком ---

test("сценарий: стереть и ввести заново", () => {
  let saved = 5;
  let draft;

  // 1. Стираем содержимое. Раньше здесь поле возвращало «5».
  draft = "";
  let r = parseNumericInput(draft, { min: 1 });
  if (r.value !== null) saved = r.value;
  assert.equal(numericFieldValue(draft, saved), "", "поле не очистилось");
  assert.equal(saved, 5, "сохранённое значение тронуто без нужды");

  // 2. Набираем новое.
  draft = "1";
  r = parseNumericInput(draft, { min: 1 });
  if (r.value !== null) saved = r.value;
  assert.equal(numericFieldValue(draft, saved), "1");

  draft = "15";
  r = parseNumericInput(draft, { min: 1 });
  if (r.value !== null) saved = r.value;
  assert.equal(numericFieldValue(draft, saved), "15");
  assert.equal(saved, 15);

  // 3. Уходим из поля — черновик сброшен, показано сохранённое.
  assert.equal(numericFieldValue(undefined, saved), "15");
});

test("сценарий: стереть и уйти — возвращается прежнее значение", () => {
  const saved = 5;
  const draft = "";
  const r = parseNumericInput(draft, { min: 1 });
  // Пустое поле ничего не сохраняет.
  assert.equal(r.value, null);
  // По уходу из поля черновик сброшен — видно прежнее число.
  assert.equal(numericFieldValue(undefined, saved), "5");
});