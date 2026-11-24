import test from "node:test";
import assert from "node:assert/strict";

import {
  ruleDates,
  spansSeveralDays,
  ruleOccurrenceCount,
} from "../src/domain/schedule-dates.js";
import { UI_SOUNDS, playUiSound } from "../src/lib/ui-sounds.js";
import {
  swipeOffset,
  swipeArmed,
  swipeMaxOffset,
} from "../src/lib/swipe-math.js";

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

// --- Арифметика слайдера «Удалить все!» ---

test("ползунок едет вправо за пальцем", () => {
  assert.equal(swipeOffset({ startX: 30, currentX: 130, max: 300 }), 100);
});

test("ползунок не уезжает в минус при движении влево", () => {
  assert.equal(swipeOffset({ startX: 130, currentX: 30, max: 300 }), 0);
});

test("ползунок не выходит за правый край дорожки", () => {
  assert.equal(swipeOffset({ startX: 30, currentX: 999, max: 300 }), 300);
});

test("жест засчитывается только у правого края", () => {
  assert.equal(swipeArmed(100, 300), false);
  assert.equal(swipeArmed(255, 300), true); // 0.85 от 300
  assert.equal(swipeArmed(300, 300), true);
});

test("без дорожки жест не засчитывается", () => {
  assert.equal(swipeArmed(0, 0), false);
});

test("дорожка учитывает ширину ползунка", () => {
  assert.equal(swipeMaxOffset(361, 48, 8), 305);
  assert.equal(swipeMaxOffset(0, 48, 8), 1);
});
