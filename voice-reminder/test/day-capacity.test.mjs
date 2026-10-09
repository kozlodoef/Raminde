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
test("24 occurrences on one day are accepted; 25 are rejected", () => {
  const saved = Array.from({ length: 23 }, (_, i) => rule("e" + i));
  assert.doesNotThrow(() => assertDailyCapacity(saved, [rule("last")]));
  assert.throws(
    () => assertDailyCapacity([...saved, rule("last")], [rule("overflow")]),
    /25 событий/,
  );
});
test("multiple times consume multiple places on each selected day", () => {
  const saved = Array.from({ length: 22 }, (_, i) => rule("e" + i));
  assert.throws(
    () => assertDailyCapacity(saved, [rule("three", 3, [day, "2026-11-09"])]),
    /25 событий/,
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
    /25 событий/,
  );
});
test("explicit dates far beyond a year still respect the limit", () => {
  const future = "2080-01-04",
    saved = Array.from({ length: 24 }, (_, i) => rule("e" + i, 1, [future]));
  assert.throws(
    () => assertDailyCapacity(saved, [rule("future", 1, [future])]),
    /25 событий/,
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

test("a twenty-fifth draft sector never displaces a saved sector", () => {
  const saved = Array.from({ length: 24 }, (_, i) => ({
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
  assert.equal(segments.length, 25);
  assert.ok(segments.slice(0, 24).every((s) => !s.pending));
});
