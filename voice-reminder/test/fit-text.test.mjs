import assert from "node:assert/strict";
import test from "node:test";

import { fitFontSize, measureText, FONT_STEPS, MIN_FONT } from "../src/lib/fit-text.js";

test("fitFontSize: короткая фраза получает самый крупный шрифт", () => {
  const size = fitFontSize("позвонить маме", { width: 320, height: 120 });
  assert.equal(size, FONT_STEPS[0]);
});

test("fitFontSize: длинная фраза получает шрифт мельче", () => {
  const long = "напомни двадцать пятого декабря в 19:30 купить подарки детям на новый год и не забыть про открытки";
  const size = fitFontSize(long, { width: 320, height: 120 });
  const short = fitFontSize("позвонить маме", { width: 320, height: 120 });
  assert.ok(size < short, "длинная фраза должна получить шрифт мельче");
});

test("fitFontSize: текст помещается в поле при выбранном размере", () => {
  const phrase =
    "напомни завтра в 07:00 полить цветы в саду и проверить почту";
  const box = { width: 320, height: 120 };
  const size = fitFontSize(phrase, box);
  const measured = measureText(phrase, size, box.width, box.height);
  assert.ok(
    measured.fits || size === MIN_FONT,
    `текст не помещается даже при выбранном размере ${size}`,
  );
});

test("fitFontSize: ниже минимума не опускается", () => {
  const huge = "слово ".repeat(300);
  const size = fitFontSize(huge, { width: 200, height: 80 });
  assert.equal(size, MIN_FONT);
});

test("measureText: пустой текст помещается всегда", () => {
  const m = measureText("", 20, 300, 100);
  assert.equal(m.fits, true);
  assert.equal(m.lines, 0);
});

test("measureText: больше текста — больше строк", () => {
  const short = measureText("привет", 18, 300, 100);
  const long = measureText("привет ".repeat(40), 18, 300, 100);
  assert.ok(long.lines > short.lines);
});

test("measureText: нулевая ширина не ломает расчёт", () => {
  const m = measureText("текст", 18, 0, 100);
  assert.equal(m.fits, true);
});