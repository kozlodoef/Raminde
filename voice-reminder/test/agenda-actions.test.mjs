import test from "node:test";
import assert from "node:assert/strict";

import {
  ruleDates,
  spansSeveralDays,
  ruleOccurrenceCount,
  occurrenceScope,
  scopeWording,
} from "../src/domain/schedule-dates.js";
import { UI_SOUNDS, playUiSound } from "../src/lib/ui-sounds.js";
import {
  parseTimeDigits,
  formatTimeDigits,
  stepTimeDigit,
} from "../src/lib/flip-time.js";

const dated = (dates) => ({ schedule: { kind: "dates", dates } });
const once = (at) => ({ schedule: { kind: "once", at } });
const daily = () => ({ schedule: { kind: "calendar", frequency: "daily" } });

// --- Сколько дат у напоминания ---

test("одна дата — это одно событие", () => {
  assert.equal(ruleDates(dated(["2026-11-24"])).length, 1);
  assert.equal(spansSeveralDays(dated(["2026-11-24"])), false);
});

test("несколько дат требуют выбора «только это / все»", () => {
  const r = dated(["2026-11-24", "2026-11-26"]);
  assert.equal(ruleDates(r).length, 2);
  assert.equal(spansSeveralDays(r), true);
});

test("повторяющиеся даты не удваивают счёт", () => {
  assert.deepEqual(ruleDates(dated(["2026-11-24", "2026-11-24"])), [
    "2026-11-24",
  ]);
});

test("разовое напоминание считается по своей дате", () => {
  const r = once(new Date("2026-11-24T19:30:00").toISOString());
  assert.deepEqual(ruleDates(r), ["2026-11-24"]);
  assert.equal(spansSeveralDays(r), false);
});

test("ежедневное правило не считается серией дат", () => {
  // У повторов нет списка дат: спрашивать «только этот день или все» не о чем.
  assert.deepEqual(ruleDates(daily()), []);
  assert.equal(spansSeveralDays(daily()), false);
});

test("правило без расписания не ломает разбор", () => {
  assert.deepEqual(ruleDates(undefined), []);
  assert.deepEqual(ruleDates({}), []);
});

// --- Звуки интерфейса ---

test("звуки действий объявлены", () => {
  assert.deepEqual(UI_SOUNDS.sort(), ["confirm", "delete", "edit", "tick", "toggle"]);
});

test("проигрывание звука без браузера не падает", () => {
  // В Node нет AudioContext: функция должна молча ничего не сделать, а не
  // бросить исключение — иначе удаление напоминания сломается в тестах.
  assert.doesNotThrow(() => playUiSound("delete"));
  assert.doesNotThrow(() => playUiSound("unknown"));
});

test("выключенный звук не проигрывается", () => {
  assert.doesNotThrow(() => playUiSound("delete", { enabled: false }));
});

// --- Сколько всего срабатываний у правила ---

test("одна дата и одно время — одно событие", () => {
  assert.equal(ruleOccurrenceCount(dated(["2026-11-24"])), 1);
});

test("одна дата и два времени считаются двумя событиями", () => {
  const r = {
    schedule: {
      kind: "dates",
      dates: ["2026-11-24"],
      times: ["09:00", "12:00"],
    },
  };
  assert.equal(ruleOccurrenceCount(r), 2);
});

test("две даты и два времени — четыре события", () => {
  const r = {
    schedule: {
      kind: "dates",
      dates: ["2026-11-24", "2026-11-26"],
      times: ["09:00", "12:00"],
    },
  };
  assert.equal(ruleOccurrenceCount(r), 4);
});

test("одна дата с двумя временами не считается несколькими датами", () => {
  // Ошибка, которую замечал человек: «запланировано на несколько дат»
  // появлялось, хотя дата была одна. Спрашивать нужно только при
  // нескольких ДАТАХ, а не при нескольких временах в один день.
  const r = {
    schedule: {
      kind: "dates",
      dates: ["2026-11-24"],
      times: ["09:00", "12:00"],
    },
  };
  const s = occurrenceScope(r);
  assert.equal(s.ask, false);
  assert.equal(s.multiDay, false);
  assert.equal(scopeWording(r), "запланировано один раз");
});

test("две даты с одним временем требуют выбора", () => {
  const r = {
    schedule: {
      kind: "dates",
      dates: ["2026-11-24", "2026-11-26"],
      times: ["09:00"],
    },
  };
  const s = occurrenceScope(r);
  assert.equal(s.ask, true);
  assert.equal(s.multiDay, true);
  assert.match(scopeWording(r), /несколько дат/);
});

test("разовое напоминание — одно событие", () => {
  assert.equal(
    ruleOccurrenceCount(once(new Date("2026-11-24T19:30:00").toISOString())),
    1,
  );
});

test("повтор не имеет конечного числа событий", () => {
  assert.equal(ruleOccurrenceCount(daily()), 0);
  assert.equal(ruleOccurrenceCount(undefined), 0);
});

// --- Перекидные цифры времени ---

test("разбор времени в четыре цифры", () => {
  assert.deepEqual(parseTimeDigits("15:00"), [1, 5, 0, 0]);
  assert.deepEqual(parseTimeDigits("07:30"), [0, 7, 3, 0]);
  assert.deepEqual(parseTimeDigits("9:5"), [0, 9, 0, 5]);
  assert.deepEqual(parseTimeDigits("00:00"), [0, 0, 0, 0]);
});

test("сборка строки из цифр", () => {
  assert.equal(formatTimeDigits([1, 5, 0, 0]), "15:00");
  assert.equal(formatTimeDigits([0, 7, 3, 0]), "07:30");
});

test("минуты: 59 → 00 с шагом единицы", () => {
  let d = parseTimeDigits("15:59");
  d = stepTimeDigit(d, 3, 1);
  assert.deepEqual(d, [1, 5, 0, 0]);
  assert.equal(formatTimeDigits(d), "15:00");
});

test("минуты: 00 → 59 с шагом назад", () => {
  let d = parseTimeDigits("00:00");
  d = stepTimeDigit(d, 3, -1);
  assert.deepEqual(d, [0, 0, 5, 9]);
  assert.equal(formatTimeDigits(d), "00:59");
});

test("часы: 23 → 00 (24 часа не бывает)", () => {
  // Целый час оборачивается по кругу: после 23:00 идёт 00:00.
  let d = parseTimeDigits("23:00");
  d = stepTimeDigit(d, 1, 1);
  assert.deepEqual(d, [0, 0, 0, 0]);
  assert.equal(formatTimeDigits(d), "00:00");
});

test("часы: 00 → 23 с шагом назад", () => {
  let d = parseTimeDigits("00:00");
  d = stepTimeDigit(d, 1, -1);
  assert.deepEqual(d, [2, 3, 0, 0]);
  assert.equal(formatTimeDigits(d), "23:00");
});

test("часы: 10 → 20 с шагом десятков", () => {
  // Десятки часов сдвигают весь час на 10.
  let d = parseTimeDigits("10:00");
  d = stepTimeDigit(d, 0, 1);
  assert.deepEqual(d, [2, 0, 0, 0]);
  assert.equal(formatTimeDigits(d), "20:00");
});

test("минуты: 59 → 09 с шагом десятков", () => {
  let d = parseTimeDigits("15:59");
  d = stepTimeDigit(d, 2, 1);
  assert.deepEqual(d, [1, 5, 0, 9]);
  assert.equal(formatTimeDigits(d), "15:09");
});
