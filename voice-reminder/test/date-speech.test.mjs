import test from "node:test";
import assert from "node:assert/strict";

import { parseEditor } from "../src/domain/home-editor.js";
import { buildGroup, dropDateWords } from "../src/domain/groups.js";

const NOW = new Date("2026-11-24T10:00:00");
const FREE = { dates: false };
const PAID = { dates: true };

/** Собирает расписание с указанной датой, чтобы не думать о времени. */
function scheduleOf(phrase, options, now = NOW) {
  const draft = parseEditor(phrase, { selectedDates: [] }, now, options);
  return {
    draft,
    schedule: buildGroup({ ...draft, text: draft.text || "" }, now.getTime(), {})
      .schedule,
  };
}

test("бесплатная версия: дата из речи не разбирается — встаёт на сегодня", () => {
  const { schedule } = scheduleOf("в пятницу в 15:00 позвонить маме", FREE);
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
  assert.deepEqual(schedule.times, ["15:00"]);
});

test("бесплатная версия: сказанное «завтра» не попадает в текст", () => {
  const { draft } = scheduleOf("завтра в семь утра полить цветы", FREE, new Date("2026-11-24T05:00:00"));
  assert.equal(draft.text, "Полить цветы");
});

test("бесплатная версия: названная словами дата не попадает в текст", () => {
  const { draft, schedule } = scheduleOf(
    "двадцать пятого декабря в 19:30 купить подарки",
    FREE,
  );
  assert.equal(draft.text, "Купить подарки");
  assert.deepEqual(schedule.dates, ["2026-11-24"]);
  assert.deepEqual(schedule.times, ["19:30"]);
});

test("бесплатная версия: время и событие распознаются", () => {
  const { draft, schedule } = scheduleOf("купить хлеб в обед", FREE);
  assert.equal(draft.text, "Купить хлеб");
  assert.deepEqual(schedule.times, ["13:00"]);
});

test("бесплатная версия: отмеченная на календаре дата важнее сказанной", () => {
  const draft = parseEditor("завтра в 15:00 позвонить", { selectedDates: ["2026-12-01"] }, NOW, FREE);
  assert.deepEqual(draft.selectedDates, ["2026-12-01"]);
  assert.equal(draft.dateConflict, null);
  const schedule = buildGroup({ ...draft, text: draft.text }, NOW.getTime(), {})
    .schedule;
  assert.deepEqual(schedule.dates, ["2026-12-01"]);
});

test("платная версия: дата и время из речи разбираются", () => {
  const { schedule } = scheduleOf("в пятницу в 15:00 позвонить маме", PAID);
  assert.deepEqual(schedule.dates, ["2026-11-27"]);
  assert.deepEqual(schedule.times, ["15:00"]);
});

test("dropDateWords убирает слова даты, но не событие", () => {
  assert.equal(dropDateWords("завтра полить цветы"), "полить цветы");
  assert.equal(dropDateWords("в пятницу позвонить маме"), "позвонить маме");
  assert.equal(dropDateWords("полить цветы"), "полить цветы");
  assert.equal(dropDateWords("25.12 купить подарки"), "купить подарки");
});

test("dropDateWords не портит название события", () => {
  // «Май» — и месяц, и имя; но слово без числа перед ним остаётся событием.
  assert.equal(dropDateWords("позвонить брату"), "позвонить брату");
  assert.equal(dropDateWords("полить цветы в семь утра"), "полить цветы в семь утра");
});

test("dropDateWords сохраняет пробелы по краям при наборе", () => {
  // Пробел в конце человек набрал только что. Раньше он срезался, и
  // следующее слово печаталось вплотную — «купить хлеб» → «купитьхлеб».
  assert.equal(dropDateWords("купить "), "купить ");
  assert.equal(dropDateWords("купить хлеб "), "купить хлеб ");
  assert.equal(dropDateWords("   "), "   ");
  assert.equal(dropDateWords("  купить  "), "  купить  ");
});

test("dropDateWords не съедает обычные слова, похожие на месяцы", () => {
  // Основа месяца с «[а-яё]*» ловила их: «купить средство» оставалось
  // без слова, «купить мартышку игрушку» — без первых двух.
  assert.equal(dropDateWords("купить средство для мытья"), "купить средство для мытья");
  assert.equal(dropDateWords("купить мартышку игрушку"), "купить мартышку игрушку");
  assert.equal(dropDateWords("мармелад купить"), "мармелад купить");
  assert.equal(dropDateWords("августейший визит"), "августейший визит");
});

test("dropDateWords убирает дату вместе с предлогом", () => {
  // Предлог принадлежал дате: без него оставалось висячее «в».
  assert.equal(dropDateWords("в мае поехать"), "поехать");
  assert.equal(dropDateWords("записаться на апрель"), "записаться");
  assert.equal(dropDateWords("в среду постирать"), "постирать");
  assert.equal(dropDateWords("по средам зарядка"), "зарядка");
});
