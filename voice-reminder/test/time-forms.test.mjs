// Тест-таблица всех русских форм времени.
//
// Главная мысль: время называется по-разному, и приложение обязано понимать
// все формы одинаково — и когда фразу произнесли голосом, и когда её набрали
// руками, и то, что видно в поле ввода. Раньше каждая форма чинилась отдельно
// в одном из трёх модулей, поэтому ошибка возвращалась.
//
// Каталог TIME_FORMS — источник форм. Здесь он прогоняется через реальные
// пути: parseReminder (голос), parseGroup/parseEditor (то, что сохраняется) и
// toDigits (что видно в поле). Все три должны дать одно время.
import test from "node:test";
import assert from "node:assert/strict";

import { TIME_FORMS, formatClock } from "../src/domain/time-lexicon.js";
import { parseReminder } from "../src/lib/timeParser.js";
import { parseEditor } from "../src/domain/home-editor.js";
import { toDigits } from "../src/domain/phrase-digits.js";
import { parseGroup } from "../src/domain/groups.js";

// Утро, чтобы все времена из каталога были впереди и не переносились на завтра.
const NOW = new Date(2026, 11, 15, 6, 0, 0);
const pad = (n) => String(n).padStart(2, "0");

/** Время из голосового разбора (parseReminder) — «ЧЧ:ММ». */
function voiceTime(phrase) {
  const r = parseReminder(phrase, NOW);
  if (!r.when) return null;
  return `${pad(r.when.getHours())}:${pad(r.when.getMinutes())}`;
}

/** Время, которое сохранится: parseGroup → times. */
function savedTime(phrase) {
  const g = parseGroup(phrase, [], NOW, { dates: false });
  const times = g.times || [];
  return times.length ? times[0] : null;
}

/** Время в поле редактора — то, что видит человек. */
function editorTime(phrase) {
  const draft = parseEditor(phrase, { selectedDates: [] }, NOW, { dates: false });
  const shown = toDigits(phrase, draft, NOW);
  return { shown, times: draft.times || [] };
}

// --- 1. Каждая форма каталога понимается всеми тремя путями ---

for (const form of TIME_FORMS) {
  test(`время: «${form.phrase}» → ${form.hm}`, () => {
    const voice = voiceTime(form.phrase);
    assert.equal(voice, form.hm, `голос: получили ${voice}, ждали ${form.hm}`);
    const saved = savedTime(form.phrase);
    assert.equal(saved, form.hm, `сохраняется: получили ${saved}, ждали ${form.hm}`);
    const editor = editorTime(form.phrase);
    assert.deepEqual(
      editor.times,
      [form.hm],
      `редактор: получили ${JSON.stringify(editor.times)}, ждали ${form.hm}`,
    );
    // В поле ввода не должно остаться слов времени — вместо них цифры.
    const leftover = editor.shown.match(
      /\b(?:половина|половине|половину|четверть|четверти|полдень|полночь|без)\b/iu,
    );
    assert.equal(
      leftover,
      null,
      `в поле остались слова времени: ${JSON.stringify(editor.shown)}`,
    );
    // И в самом тексте напоминания не должно остаться «30», «тридцать» и т.п.
    // Дата рядом со временем — это нормально («в 16:00 25.05»), поэтому
    // проверяем именно разорванное время: «16:00 30» или «16:00 тридцать».
    assert.ok(
      !/\d{1,2}:\d{2}\s+(?:\d{1,2}|(?:ноль|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать|сорок|пятьдесят))(?![\d.,])/u.test(
        editor.shown,
      ),
      `время разорвано в поле: ${JSON.stringify(editor.shown)}`,
    );
  });
}

// --- 2. Минуты не попадают в текст напоминания ---

test("минуты после часа не остаются в тексте", () => {
  for (const phrase of [
    "напомни поесть картошки в 10:00 тридцать",
    "напомни поесть картошки в 10:00 30",
    "напомни поесть картошки в 10 30",
  ]) {
    const r = parseReminder(phrase, NOW);
    assert.ok(
      !/\b(?:30|тридцать)\b/u.test(r.text),
      `минуты остались в тексте «${phrase}»: ${JSON.stringify(r.text)}`,
    );
  }
});

// --- 3. Даты не превращаются во время ---

test("число перед месяцем — это дата, а не минуты", () => {
  // «в 16 25 мая»: 25 — день месяца. Время должно остаться 16:00.
  const g = parseGroup("поздравить в 16 25 мая", [], NOW, { dates: true });
  assert.equal(g.times[0], "16:00");
  // А «25.12» — дата, а не время.
  assert.equal(formatClock(25, 12), null);
});

test("«10 05» не считается временем: похоже на дату", () => {
  const g = parseGroup("купить подарки 10 05", [], NOW, { dates: false });
  assert.deepEqual(g.times, [], "10 05 разобрано как время: " + JSON.stringify(g.times));
});

// --- 4. Количества не превращаются во время ---

test("количество после часа не становится минутами", () => {
  const cases = [
    ["напомни в 8 два хлеба купить", "08:00", "Два хлеба"],
    ["напомни в 10:00 тридцать человек придут", "10:00", "Тридцать человек"],
  ];
  for (const [phrase, hm, text] of cases) {
    const r = parseReminder(phrase, NOW);
    assert.equal(voiceTime(phrase), hm, `время в «${phrase}»`);
    assert.match(r.text, new RegExp(text, "iu"), `текст в «${phrase}»: ${r.text}`);
  }
});

// --- 5. Одна и та же запись времени — один результат во всех путях ---

test("все пути дают одно время для каждой формы", () => {
  const mismatches = [];
  for (const form of TIME_FORMS) {
    const v = voiceTime(form.phrase);
    const s = savedTime(form.phrase);
    if (v !== s) mismatches.push(`${form.phrase}: голос ${v} ≠ сохраняется ${s}`);
  }
  assert.deepEqual(mismatches, [], mismatches.join("; "));
});
