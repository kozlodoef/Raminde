import test from "node:test";
import assert from "node:assert/strict";

import { isMeaningfulSegment } from "../src/lib/continuous-dictation.js";

// Модель, которой подсунули тишину, всё равно возвращает слово. Задача
// фильтра — не пустить такие обрывки в текст напоминания и не тронуть
// настоящую речь.

test("обрывки на тишине не считаются речью", () => {
  for (const junk of [
    "включи",
    "и",
    "на",
    "о",
    "э",
    "мм",
    "ну да",
    "стоп",
    "отмена",
    "так вот",
  ]) {
    assert.equal(
      isMeaningfulSegment(junk),
      false,
      `«${junk}» не должно попасть в текст`,
    );
  }
});

test("пустая строка и одни знаки не считаются речью", () => {
  for (const empty of ["", "   ", "...", ",", "-"]) {
    assert.equal(isMeaningfulSegment(empty), false);
  }
});

test("настоящие напоминания проходят фильтр", () => {
  for (const real of [
    "напомни позвонить маме",
    "купить хлеб",
    "полить цветы в семь утра",
    "позвонить",
    "напомнить",
    "сдать отчёт",
    "забрать ребёнка из школы",
  ]) {
    assert.equal(
      isMeaningfulSegment(real),
      true,
      `«${real}» — настоящая речь, отсекать нельзя`,
    );
  }
});

test("служебное слово внутри фразы не мешает", () => {
  // Главное — чтобы фильтр не резал фразу из-за короткого слова в начале.
  assert.equal(isMeaningfulSegment("в семь утра полить цветы"), true);
  assert.equal(isMeaningfulSegment("и позвонить маме"), true);
});

test("короткое, но настоящее слово не отсекается", () => {
  // «Хлеб», «чай», «сок» — настоящие напоминания, хоть и короткие.
  // Фильтр ловит служебные слова, а не длину.
  assert.equal(isMeaningfulSegment("хлеб"), true);
  assert.equal(isMeaningfulSegment("чай"), true);
  assert.equal(isMeaningfulSegment("позвонить"), true);
});
