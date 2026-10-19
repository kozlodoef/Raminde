import test from "node:test";
import assert from "node:assert/strict";
import { startContinuousDictation } from "../src/lib/continuous-dictation.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100 && !fn(); i++) await sleep(3);
  assert.ok(fn());
}
function fake() {
  const cycles = [];
  return {
    cycles,
    start: async (opts) => {
      let yes, no;
      const promise = new Promise((y, n) => {
        yes = y;
        no = n;
      });
      const s = {
        opts,
        promise,
        stop() {
          yes("");
        },
        abort() {
          yes("");
        },
        yes,
        no,
      };
      cycles.push(s);
      opts.onStart?.();
      return s;
    },
  };
}
test("a natural end starts another session; only Done resolves the logical recording", async () => {
  const f = fake(),
    finals = [],
    d = startContinuousDictation({
      start: f.start,
      onFinal: (t) => finals.push(t),
      restartDelayMs: 5,
    });
  let ended = false;
  d.promise.then(() => (ended = true));
  await until(() => f.cycles.length === 1);
  f.cycles[0].yes("Купить хлеб в девять");
  await until(() => f.cycles.length === 2);
  assert.equal(ended, false);
  f.cycles[1].yes("нет в десять");
  await until(() => f.cycles.length === 3);
  d.stop();
  assert.equal(await d.promise, "Купить хлеб в девять нет в десять");
  assert.equal(finals.length, 2);
  assert.equal(f.cycles[0].opts.cue, true);
  assert.equal(f.cycles[1].opts.cue, false);
});
test("silence does not turn the mode off", async () => {
  const f = fake(),
    d = startContinuousDictation({ start: f.start, restartDelayMs: 5 });
  await until(() => f.cycles.length === 1);
  f.cycles[0].no(Error("no-speech"));
  await until(() => f.cycles.length === 2);
  d.stop();
  assert.equal(await d.promise, "");
});
test("Done in a gap prevents the next restart", async () => {
  const f = fake();
  let waiting = false;
  const d = startContinuousDictation({
    start: f.start,
    onWaiting: () => (waiting = true),
    restartDelayMs: 80,
  });
  await until(() => f.cycles.length === 1);
  f.cycles[0].yes("Текст");
  await until(() => waiting);
  d.stop();
  assert.equal(await d.promise, "Текст");
  await sleep(90);
  assert.equal(f.cycles.length, 1);
});
test("abort discards interim audio and prevents a restart", async () => {
  const f = fake(),
    d = startContinuousDictation({ start: f.start, restartDelayMs: 5 });
  await until(() => f.cycles.length === 1);
  d.abort();
  assert.equal(await d.promise, "");
  await sleep(10);
  assert.equal(f.cycles.length, 1);
});
test("permission denial is visible, not an endless permission loop", async () => {
  let n = 0;
  const d = startContinuousDictation({
    start: async () => {
      n++;
      throw Error("not-allowed");
    },
    restartDelayMs: 5,
  });
  await assert.rejects(d.promise, /not-allowed/);
  assert.equal(n, 1);
});
test("repeated service errors stop with a visible failure", async () => {
  let n = 0;
  const d = startContinuousDictation({
    start: async () => {
      n++;
      throw Error("speech-error-2");
    },
    restartDelayMs: 5,
  });
  await assert.rejects(d.promise, /speech-error/);
  assert.equal(n, 3);
});
test("hidden application does not acquire microphone", async () => {
  let n = 0;
  const d = startContinuousDictation({
    start: async () => {
      n++;
    },
    shouldContinue: () => false,
  });
  assert.equal(await d.promise, "");
  assert.equal(n, 0);
});
test("interim results are shown but never silently treated as final", async () => {
  const f = fake(),
    live = [],
    d = startContinuousDictation({
      start: f.start,
      onInterim: (t) => live.push(t),
    });
  await until(() => f.cycles.length === 1);
  f.cycles[0].opts.onInterim("Неподтверждённый текст");
  d.stop();
  assert.equal(await d.promise, "");
  assert.deepEqual(live, ["Неподтверждённый текст"]);
});
test("Done while native startup is pending still stops the new recognizer", async () => {
  let ready,
    stops = 0;
  const start = new Promise((r) => (ready = r)),
    d = startContinuousDictation({ start: () => start });
  await sleep(1);
  d.stop();
  let final;
  const promise = new Promise((r) => (final = r));
  ready({
    promise,
    stop() {
      stops++;
      final("Готовый текст");
    },
    abort() {
      final("");
    },
  });
  assert.equal(await d.promise, "Готовый текст");
  assert.equal(stops, 1);
});
