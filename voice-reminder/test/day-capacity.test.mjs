import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDailyCapacity,
  daySegments,
} from "../src/domain/day-capacity.js";
import { COLORS } from "../src/domain/groups.js";
const day = "2026-11-08";
const rule = (id, n = 1, dates = [day]) => ({
  id,
  text: id,
  enabled: true,
  color: COLORS[Number(id) || 0],
  schedule: {
    kind: "dates",
    timezoneMode: "fixed",
    timezone: "UTC",
    dates,
    times: Array.from(
      { length: n },
      (_, i) => String(i).padStart(2, "0") + ":00",
    ),
  },
});
// Предел на день — 24, по числу часов. Раньше было 12, и это упиралось
// в обычный плотный день.
test("24 occurrences on one day are accepted; 25 are rejected", () => {
  const saved = Array.from({ length: 23 }, (_, i) => rule("e" + i));
  assert.doesNotThrow(() => assertDailyCapacity(saved, [rule("last")]));
  assert.throws(
    () => assertDailyCapacity([...saved, rule("last")], [rule("overflow")]),
    /25 напоминаний/,
  );
});
test("multiple times consume multiple places on each selected day", () => {
  const saved = Array.from({ length: 22 }, (_, i) => rule("e" + i));
  assert.throws(
    () => assertDailyCapacity(saved, [rule("three", 3, [day, "2026-11-09"])]),
    /напоминаний/,
  );
});
test("editing a group replaces old occurrences, rather than doubling their count", () => {
  const saved = Array.from({ length: 24 }, (_, i) => rule("e" + i));
  assert.doesNotThrow(() =>
    assertDailyCapacity(saved, [{ ...saved[0], text: "Edited" }]),
  );
});
test("batch is validated together before any groups are saved", () => {
  const saved = Array.from({ length: 23 }, (_, i) => rule("e" + i));
  assert.throws(
    () => assertDailyCapacity(saved, [rule("a"), rule("b")]),
    /25 напоминаний/,
  );
});
test("explicit dates far beyond a year still respect the limit", () => {
  const future = "2080-01-04",
    saved = Array.from({ length: 24 }, (_, i) => rule("e" + i, 1, [future]));
  assert.throws(
    () => assertDailyCapacity(saved, [rule("future", 1, [future])]),
    /25 напоминаний/,
  );
});
test("paused new group does not consume places", () => {
  const saved = Array.from({ length: 24 }, (_, i) => rule("e" + i));
  assert.doesNotThrow(() =>
    assertDailyCapacity(saved, [{ ...rule("paused"), enabled: false }]),
  );
});
test("ring deduplicates stored occurrence and its preview", () => {
  const e = { id: "a@1", reminderId: "a", date: day, at: 1, color: COLORS[0] };
  assert.equal(
    daySegments([e, e], day, { dates: [day], draftId: "a", color: COLORS[1] })
      .length,
    1,
  );
});
test("new selection appends a pending sector without modifying stored colour", () => {
  const e = { id: "a@1", reminderId: "a", date: day, at: 1, color: COLORS[0] };
  const v = daySegments([e], day, {
    dates: [day],
    draftId: "b",
    color: COLORS[1],
  });
  assert.equal(v.length, 2);
  assert.equal(v[0].color, COLORS[0]);
  assert.equal(v[1].color, COLORS[1]);
  assert.equal(v[1].pending, true);
});
test("one group at three times has three identically coloured segments", () => {
  const v = daySegments(
    [1, 2, 3].map((at) => ({
      id: "a@" + at,
      reminderId: "a",
      date: day,
      at,
      color: COLORS[0],
    })),
    day,
  );
  assert.equal(v.length, 3);
  assert.equal(new Set(v.map((x) => x.color)).size, 1);
});
test("24 default colours are distinct", () =>
  assert.equal(new Set(COLORS).size, 24));

// --- Прозвучавшие напоминания занимают место в дне ---
//
// Предел в три напоминания на бесплатной версии обходился бы в два нажатия:
// поставить напоминание, дождаться, удалить его. Поэтому место занимает не
// только запланированное напоминание, но и прозвучавшее.
const free = (saved, next, fired) =>
  assertDailyCapacity(saved, [next], { fired, maxPerDay: 3 });

test("прозвучавшее напоминание не освобождает день после удаления", () => {
  // Три напоминания прозвучали, их удалили — правил не осталось, день закрыт.
  const fired = { [day]: ["a@1", "b@2", "c@3"] };
  assert.throws(() => free([], rule("new"), fired), /прозвучало 3/);
});
test("прозвучавшее напоминание считается вместе с запланированным", () => {
  const fired = { [day]: ["a@1", "b@2"] };
  assert.doesNotThrow(() => free([], rule("third"), fired));
  assert.throws(() => free([], rule("third", 2), fired), /предел подписки/);
});
test("одно и то же напоминание не считается дважды", () => {
  // Напоминание и запланировано, и уже прозвучало — это одно место, не два.
  const fired = { [day]: ["a@1"] };
  assert.doesNotThrow(() => free([], rule("a"), fired));
  assert.throws(() => free([], rule("b", 3), fired), /предел подписки/);
});
test("прозвучавшее в другой день не закрывает этот", () => {
  const fired = { "2026-11-09": ["a@1", "b@2", "c@3"] };
  assert.doesNotThrow(() => free([], rule("new"), fired));
});
test("без сведений о срабатываниях предел считается как раньше", () => {
  // Старые данные без поля fired не должны внезапно блокировать сохранение.
  assert.doesNotThrow(() => free([], rule("a"), undefined));
  assert.doesNotThrow(() => free([], rule("a"), {}));
});
test("сообщение о закрытом дне объясняет, что удаление не помогает", () => {
  const fired = { [day]: ["a@1", "b@2", "c@3"] };
  assert.throws(
    () => free([], rule("new"), fired),
    /Удаление их день не освобождает/,
  );
});

test("a thirteenth draft sector never displaces a saved sector", () => {
  const saved = Array.from({ length: 12 }, (_, i) => ({
    id: "s@" + i,
    reminderId: "saved-" + i,
    date: day,
    at: i + 1,
    color: COLORS[i],
  }));
  const pending = {
    id: "d@0",
    reminderId: "draft",
    date: day,
    at: 0,
    color: COLORS[0],
  };
  const segments = daySegments([...saved, pending], day, { draftId: "draft" });
  assert.equal(segments.length, 13);
  assert.ok(segments.slice(0, 12).every((s) => !s.pending));
});
