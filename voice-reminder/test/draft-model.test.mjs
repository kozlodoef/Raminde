// Тесты черновика и вспомогательных функций, вынесенных из App.jsx.
//
// Зачем они нужны. Раньше эти функции жили внутри компонента App и были
// недоступны для проверки: чтобы протестировать shiftMonth, пришлось бы
// рендерить всё приложение. После выноса в domain/draft-model.js они стали
// обычными функциями.
import test from "node:test";
import assert from "node:assert/strict";
import {
  uid,
  eventCount,
  blank,
  cachedDrafts,
  dateLabel,
  shiftMonth,
} from "../src/domain/draft-model.js";
import { COLORS } from "../src/domain/groups.js";

test("uid выдаёт разные значения", () => {
  const a = uid();
  const b = uid();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/i);
});

test("eventCount склоняет русские формы", () => {
  assert.equal(eventCount(1), "1 событие");
  assert.equal(eventCount(2), "2 события");
  assert.equal(eventCount(3), "3 события");
  assert.equal(eventCount(4), "4 события");
  assert.equal(eventCount(5), "5 событий");
  assert.equal(eventCount(11), "11 событий", "11 — исключение, а не «событие»");
  assert.equal(eventCount(21), "21 событие");
  assert.equal(eventCount(22), "22 события");
  assert.equal(eventCount(0), "0 событий");
});

test("blank создаёт пустой черновик нужной формы", () => {
  const d = blank();
  assert.equal(d.text, "");
  assert.equal(d.phrase, "");
  assert.deepEqual(d.dates, []);
  assert.deepEqual(d.times, []);
  assert.deepEqual(d.selectedDates, []);
  assert.deepEqual(d.issues, []);
  assert.ok(d.id, "id должен быть задан");
  assert.ok(d.color, "цвет должен быть задан");
});

test("blank раздаёт цвета по кругу", () => {
  assert.equal(blank(0).color, COLORS[0]);
  assert.equal(blank(1).color, COLORS[1]);
  // Индекс больше длины палитры — цвет заворачивается, а не становится undefined.
  assert.equal(blank(COLORS.length).color, COLORS[0]);
});

test("shiftMonth двигает месяц вперёд и назад", () => {
  assert.equal(shiftMonth("2026-11", 1), "2026-12");
  assert.equal(shiftMonth("2026-11", -1), "2026-10");
  assert.equal(shiftMonth("2026-01", -1), "2025-12", "переход через год назад");
  assert.equal(shiftMonth("2026-12", 1), "2027-01", "переход через год вперёд");
});

test("shiftMonth учитывает разную длину месяцев", () => {
  // Регрессия: наивное «month - 1» с 31 марта дало бы 3 марта.
  assert.equal(shiftMonth("2026-03", -1), "2026-02");
  assert.equal(shiftMonth("2026-05", -1), "2026-04");
});

test("dateLabel печатает день и месяц по-русски", () => {
  const label = dateLabel("2026-11-07");
  assert.match(label, /7/);
  assert.match(label, /нояб/i);
});

test("cachedDrafts переживает мусор в localStorage", () => {
  const original = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      getItem: () => "{ это не json",
    };
    assert.deepEqual(cachedDrafts(), {}, "битый JSON не должен ронять приложение");

    globalThis.localStorage = {
      getItem: () => null,
    };
    assert.deepEqual(cachedDrafts(), {}, "пустое хранилище даёт пустой объект");

    globalThis.localStorage = {
      getItem: () => JSON.stringify({ draft: { text: "полить цветы" } }),
    };
    assert.equal(cachedDrafts().draft.text, "полить цветы");
  } finally {
    globalThis.localStorage = original;
  }
});
