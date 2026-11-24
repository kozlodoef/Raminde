import test from "node:test";
import assert from "node:assert/strict";

import { spokenDate, stripDate, isoDate } from "../src/domain/dates-spoken.js";
import { parseEditor } from "../src/domain/home-editor.js";
import { toDigits } from "../src/domain/phrase-digits.js";

const NOW = new Date("2026-11-22T10:00:00");

test("дата словами: порядковое число и месяц", () => {
  const r = spokenDate("напомни двадцать пятого декабря купить подарки", NOW);
  assert.equal(r.date, "2026-12-25");
});

test("дата словами: первое число месяца", () => {
  const r = spokenDate("первого сентября забрать документы", NOW);
  assert.equal(r.date, "2027-09-01", "прошедшая дата переносится на будущее");
});

test("дата словами: количественное число", () => {
  const r = spokenDate("пятого мая поехать на дачу", NOW);
  assert.equal(r.date, "2027-05-05");
});

test("дата цифрами: 25 декабря и 25.12 дают одно и то же", () => {
  const a = spokenDate("25 декабря купить подарки", NOW);
  const b = spokenDate("25.12 купить подарки", NOW);
  assert.equal(a.date, "2026-12-25");
  assert.equal(b.date, "2026-12-25");
});

test("год в фразе учитывается", () => {
  const r = spokenDate("первого сентября 2028 года", NOW);
  assert.equal(r.date, "2028-09-01");
});

test("фраза без даты не даёт ложного срабатывания", () => {
  assert.equal(spokenDate("купить хлеб и молоко", NOW), null);
  assert.equal(spokenDate("позвонить маме", NOW), null);
});

test("дата вырезается из текста напоминания", () => {
  const r = spokenDate("двадцать пятого декабря купить подарки", NOW);
  const rest = stripDate("двадцать пятого декабря купить подарки", r.match);
  assert.equal(rest, "купить подарки");
});

test("parseEditor: словесная дата попадает в даты, а не в текст", () => {
  const draft = parseEditor(
    "напомни двадцать пятого декабря в 19:30 купить подарки",
    { selectedDates: [] },
    NOW,
  );
  assert.deepEqual(draft.dates, ["2026-12-25"]);
  assert.deepEqual(draft.times, ["19:30"]);
  assert.ok(!/декабр/i.test(draft.text), "месяц не остаётся в тексте: " + draft.text);
});

test("parseEditor: дата и время вместе разбираются", () => {
  const draft = parseEditor("пятого мая в девять утра полить цветы", { selectedDates: [] }, NOW);
  assert.deepEqual(draft.dates, ["2027-05-05"]);
  assert.deepEqual(draft.times, ["09:00"]);
});

test("набор руками: пробел в конце не пропадает", () => {
  const typed = "купить хлеб ";
  assert.equal(toDigits(typed, {}, NOW), "купить хлеб ");
});

test("набор руками: пробел между словами сохраняется", () => {
  assert.equal(toDigits("купить хлеб", {}, NOW), "купить хлеб");
});

test("набор руками: фраза из пробелов не ломается", () => {
  assert.equal(toDigits("   ", {}, NOW), "   ");
});

test("набор руками: незаконченное время не переписывается", () => {
  // Человек печатает «позвонить маме в 10:30» посимвольно. Поле не должно
  // подставлять «10:00» на полпути: иначе следующая цифра попадала в
  // переписанный текст и получалось «10:03» вместо «10:30».
  const steps = [
    "позвонить маме в 1",
    "позвонить маме в 10",
    "позвонить маме в 10:",
    "позвонить маме в 10:3",
  ];
  for (const step of steps) {
    assert.equal(toDigits(step, {}, NOW), step, `поле переписало «${step}»`);
  }
  // Законченная запись показывается цифрами.
  assert.equal(toDigits("позвонить маме в 10:30", {}, NOW), "позвонить маме в 10:30");
  assert.equal(toDigits("поесть в 10 30", {}, NOW), "поесть в 10:30");
});

test("набор руками: незаконченная дата не вырезается", () => {
  // «25.» и «25.1» — это полпути к «25.12». Раньше они удалялись как дата,
  // и текст рассыпался прямо под руками.
  assert.equal(toDigits("встреча 25.", {}, NOW), "встреча 25.");
  assert.equal(toDigits("встреча 25.1", {}, NOW), "встреча 25.1");
});

test("isoDate отдаёт локальную дату без сдвига часового пояса", () => {
  assert.equal(isoDate(new Date(2026, 11, 25, 23, 30)), "2026-12-25");
});
