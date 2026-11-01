import test from "node:test";
import assert from "node:assert/strict";
import {
  editorPhrase,
  parseEditor,
  toggleEditorDate,
  sessionGate,
} from "../src/domain/home-editor.js";
import { buildGroup } from "../src/domain/groups.js";
const now = new Date(2026, 9, 19, 8, 0);
const empty = () => ({
  id: "draft",
  color: "#19815d",
  text: "",
  phrase: "",
  dates: [],
  times: [],
  selectedDates: [],
});
test("full editor phrase retains time; reminder subject excludes it", () => {
  const d = parseEditor("Купить хлеб в 20:00", empty(), now);
  assert.equal(editorPhrase(d), "Купить хлеб в 20:00");
  assert.equal(d.text, "Купить хлеб");
  assert.deepEqual(d.times, ["20:00"]);
  assert.equal(d.color, "#19815d");
  assert.equal(d.id, "draft");
});
test("manual phrase supports three times in one group", () => {
  const d = parseEditor(
    "Принять таблетку в девять утра, в одиннадцать и в восемь вечера",
    empty(),
    now,
  );
  assert.deepEqual(d.times, ["09:00", "11:00", "20:00"]);
});
test("calendar tap toggles and preserves one group color", () => {
  let d = toggleEditorDate(empty(), "2026-10-21");
  d = toggleEditorDate(d, "2026-10-23");
  assert.deepEqual(d.dates, ["2026-10-21", "2026-10-23"]);
  d = toggleEditorDate(d, "2026-10-21");
  assert.deepEqual(d.dates, ["2026-10-23"]);
  d = toggleEditorDate(d, "2026-10-23");
  assert.deepEqual(d.dates, []);
  assert.equal(d.color, "#19815d");
});
test("speech arriving after taps retains calendar dates", () => {
  const d = parseEditor(
    "Купить хлеб в 20",
    toggleEditorDate(empty(), "2026-10-23"),
    now,
  );
  assert.deepEqual(buildGroup(d, now.getTime()).schedule.dates, ["2026-10-23"]);
});
test("calendar tap after spoken tomorrow overrides spoken date", () => {
  const spoken = parseEditor("Завтра в 20 позвонить маме", empty(), now);
  assert.deepEqual(spoken.dates, ["2026-10-20"]);
  const picked = toggleEditorDate(spoken, "2026-10-23");
  assert.deepEqual(picked.dates, ["2026-10-23"]);
  assert.equal(picked.dateConflict, null);
});
test("different explicit speech and calendar dates require a decision", () => {
  const d = parseEditor(
    "Завтра в 20 позвонить маме",
    toggleEditorDate(empty(), "2026-10-23"),
    now,
  );
  assert.ok(d.dateConflict);
  assert.throws(() => buildGroup(d, now.getTime()), /даты/);
});
test("missing time is rejected without persisting a false success", () => {
  const d = parseEditor("Купить хлеб", empty(), now);
  assert.throws(() => buildGroup(d, now.getTime()), /сколько|время/);
});
test("empty text and missing time remain invalid", () => {
  const d = parseEditor("", empty(), now);
  assert.throws(() => buildGroup(d, now.getTime()));
});
test("implicit today remains implicit until save", () => {
  const d = parseEditor("Купить хлеб в 20", empty(), now);
  assert.deepEqual(d.dates, []);
  assert.deepEqual(buildGroup(d, now.getTime()).schedule.dates, ["2026-10-19"]);
});
test("typed replacement removes obsolete times", () => {
  const a = parseEditor("Купить хлеб в 20", empty(), now);
  const b = parseEditor("Позвонить маме в 21", a, now);
  assert.deepEqual(b.times, ["21:00"]);
  assert.equal(b.text, "Позвонить маме");
});
test("older saved drafts obtain a readable phrase", () => {
  assert.equal(
    editorPhrase({ text: "Таблетка", times: ["09:00", "20:00"] }),
    "Таблетка в 09:00 в 20:00",
  );
  assert.equal(
    editorPhrase({
      text: "Таблетка",
      originalTranscript: "В 9 принять таблетку",
    }),
    "В 9 принять таблетку",
  );
});
test("clear and immediate restart invalidate every old ASR callback", () => {
  const gate = sessionGate();
  const old = gate.next();
  assert.equal(gate.valid(old), true);
  gate.next();
  assert.equal(gate.valid(old), false);
  const fresh = gate.next();
  assert.equal(gate.valid(fresh), true);
  assert.equal(gate.valid(old), false);
});
