import test from "node:test";
import assert from "node:assert/strict";
import { isComposingReminder as composing } from "../src/domain/draft-mode.js";
test("empty home opens day events", () => assert.equal(composing(), false));
test("recording starts date selection", () =>
  assert.equal(composing({ voice: "listening" }), true));
test("starting microphone keeps date selection", () =>
  assert.equal(composing({ voice: "starting" }), true));
test("after dictation ends, unsaved text still selects dates", () =>
  assert.equal(
    composing({ draft: { text: "Купить хлеб" }, voice: "idle" }),
    true,
  ));
test("manual time or selected days retain the draft", () => {
  assert.equal(composing({ draft: { times: ["12:00"] } }), true);
  assert.equal(composing({ draft: { dates: ["2026-11-09"] } }), true);
});
test("queued unsaved groups retain creation until Done", () =>
  assert.equal(composing({ queue: [{ id: "one" }] }), true));
test("saved or cleared blank draft returns to browsing", () =>
  assert.equal(
    composing({
      draft: { text: "", dates: [], times: [] },
      queue: [],
      voice: "idle",
    }),
    false,
  ));
test("colour change alone never starts editing", () =>
  assert.equal(composing({ draft: { color: "#146ad4" } }), false));

test("interim unsaved transcript also keeps date selection after stopping", () =>
  assert.equal(composing({ live: "Купить хлеб" }), true));

test("explicit Add starts creation even before typing or dictating", () =>
  assert.equal(composing({ started: true }), true));
