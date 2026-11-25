import test from "node:test";
import assert from "node:assert/strict";

import {
  hasPastOccurrence,
  PAST_TIME_MESSAGE,
} from "../src/domain/calendar.js";
import { buildGroup } from "../src/domain/groups.js";
import { parseEditor } from "../src/domain/home-editor.js";

// 25 ноября 2026, 16:00 — «сейчас» для всех проверок.
const NOW = new Date(2026, 10, 25, 16, 0, 0);
const MS = NOW.getTime();

/** Расписание на конкретные дни и времена. */
const at = (dates, times) => ({
  kind: "dates",
  dates,
  times,
  timezoneMode: "deviceLocal",
});

// --- Сообщение о прошедшем времени ---

test("формулировка одна на всё приложение", () => {
  assert.equal(PAST_TIME_MESSAGE, "Проверьте дату и время напоминания!");
});

test("прошедшее сегодняшнее время определяется", () => {
  assert.equal(hasPastOccurrence(at(["2026-11-25"], ["10:00"]), MS), true);
});

test("будущее сегодняшнее время не считается прошедшим", () => {
  assert.equal(hasPastOccurrence(at(["2026-11-25"], ["18:00"]), MS), false);
});

test("вчерашний день — прошедший", () => {
  assert.equal(hasPastOccurrence(at(["2026-11-24"], ["10:00"]), MS), true);
});

test("завтрашний день — не прошедший", () => {
  assert.equal(hasPastOccurrence(at(["2026-11-26"], ["10:00"]), MS), false);
});

test("одна прошедшая дата среди будущих — уже повод предупредить", () => {
  assert.equal(
    hasPastOccurrence(at(["2026-11-24", "2026-11-26"], ["10:00"]), MS),
    true,
  );
});

test("все времена в будущем на будущей дате", () => {
  assert.equal(
    hasPastOccurrence(at(["2026-11-26"], ["09:00", "18:00"]), MS),
    false,
  );
});

test("одно из времён сегодня уже прошло — предупреждаем", () => {
  assert.equal(
    hasPastOccurrence(at(["2026-11-25"], ["10:00", "18:00"]), MS),
    true,
  );
});

// --- Сохранение ---

test("сохранение прошедшего времени показывает сообщение", () => {
  assert.throws(
    () => buildGroup({ text: "Позвонить", dates: ["2026-11-24"], times: ["10:00"] }, MS),
    /Проверьте дату и время напоминания!/,
  );
});

test("сохранение будущего времени проходит", () => {
  assert.doesNotThrow(() =>
    buildGroup({ text: "Позвонить", dates: ["2026-11-26"], times: ["10:00"] }, MS),
  );
});

test("раньше здесь были разные формулировки — проверяем, что их нет", () => {
  // Смысл теста: человек не должен встречать «часть выбранных дат или
  // времён уже прошла» и «нет будущих срабатываний» — это об одной ошибке.
  try {
    buildGroup({ text: "Позвонить", dates: ["2026-11-24"], times: ["10:00"] }, MS);
    assert.fail("должно было отклонить");
  } catch (e) {
    assert.equal(e.message, PAST_TIME_MESSAGE);
    assert.ok(!/часть выбранных/i.test(e.message));
    assert.ok(!/нет будущих/i.test(e.message));
  }
});

test("правка существующего напоминания не блокируется прошлым", () => {
  // allowPast: правило уже стоит, человек меняет только текст.
  assert.doesNotThrow(() =>
    buildGroup(
      { text: "Новый текст", dates: ["2026-11-24"], times: ["10:00"] },
      MS,
      { allowPast: true },
    ),
  );
});

// --- Разбор фразы из поля ввода ---

/** Сообщение, которое редактор должен показать для этого черновика. */
function noticeFor(phrase) {
  const d = parseEditor(phrase, { selectedDates: [] }, NOW, { dates: true });
  const dates = d.selectedDates?.length ? d.selectedDates : d.dates || [];
  const times = d.times || d.schedule?.times || [];
  if (!dates.length || !times.length) return "";
  return hasPastOccurrence(at(dates, times), MS) ? PAST_TIME_MESSAGE : "";
}

test("«сегодня в 10 утра» — время прошло, предупреждаем", () => {
  assert.equal(noticeFor("напомни сегодня в 10 утра позвонить"), PAST_TIME_MESSAGE);
});

test("«сегодня в 18:00» — время впереди, молчим", () => {
  assert.equal(noticeFor("напомни сегодня в 18:00 позвонить"), "");
});

test("«завтра в 10:00» — молчим", () => {
  assert.equal(noticeFor("напомни завтра в 10:00 позвонить"), "");
});
