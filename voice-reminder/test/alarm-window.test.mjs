import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Окно сработавшего напоминания должно показывать само напоминание, без
// заголовков вроде «Пора вспомнить» и без подписи «Напоминание»: они
// отвлекали от сути, и человек читал заголовок вместо текста.

const alarm = await readFile(
  new URL("../src/components/AlarmBox.jsx", import.meta.url),
  "utf8",
);
const modal = await readFile(
  new URL("../src/components/Modal.jsx", import.meta.url),
  "utf8",
);

/** Исходник без комментариев: проверяем разметку, а не пояснения в коде. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

const alarmCode = stripComments(alarm);
const modalCode = stripComments(modal);

test("в окне напоминания нет заголовка «Пора вспомнить»", () => {
  assert.ok(!/Пора вспомнить/.test(alarmCode), "старый заголовок вернулся");
});

test("нет и подписи «Напоминание» над текстом", () => {
  assert.ok(!/className="alarm-name"/.test(alarmCode), "подпись вернулась");
  // Имя может звучать в озвучке (speak), но надписью на экране — нет.
  const markup = alarmCode.slice(alarmCode.indexOf("return ("));
  assert.ok(
    !/settings\.name/.test(markup),
    "имя снова выводится надписью над текстом",
  );
});

test("текст напоминания выводится", () => {
  assert.match(alarmCode, /className="alarm-text">\{event\.text\}/);
});

test("для чтения с экрана подпись остаётся", () => {
  // Заголовка на экране нет, но role="dialog" должен иметь имя.
  assert.match(alarmCode, /label="Сработавшее напоминание"/);
  assert.match(modalCode, /aria-label=\{title \|\| label\}/);
});

test("модальное окно умеет работать без заголовка", () => {
  // title не передан — шапки с h2 быть не должно, но окно остаётся.
  assert.match(modalCode, /\(title \|\| onClose\)/);
});
