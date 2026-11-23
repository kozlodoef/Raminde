import test from "node:test";
import assert from "node:assert/strict";

import { ALERT_CUES, cueSamples, cueDurationMs } from "../src/lib/alert-cues.js";

test("каждый сигнал из списка синтезируется", () => {
  for (const cue of ALERT_CUES) {
    const s = cueSamples(cue.id);
    assert.ok(s.length > 0, `${cue.id}: нет отсчётов`);
  }
});

test("сигналы короткие — не дольше секунды", () => {
  for (const cue of ALERT_CUES) {
    const ms = cueDurationMs(cue.id);
    assert.ok(ms > 100 && ms <= 1000, `${cue.id}: ${ms} мс`);
  }
});

test("сигналы громкие: пик близок к пределу", () => {
  for (const cue of ALERT_CUES) {
    const s = cueSamples(cue.id);
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.45, `${cue.id}: пик слишком тихий (${peak.toFixed(2)})`);
    assert.ok(peak <= 1.0, `${cue.id}: выходит за шкалу (${peak.toFixed(2)})`);
  }
});

test("неизвестный сигнал не ломает выбор — звучит сигнал по умолчанию", () => {
  const s = cueSamples("неизвестный");
  assert.ok(s.length > 0);
  assert.equal(cueDurationMs("неизвестный"), cueDurationMs("alarm"));
});

test("сигналы различаются между собой", () => {
  const a = cueSamples("beep");
  const b = cueSamples("bell");
  assert.notEqual(a.length, b.length, "сигналы не должны совпадать");
});

test("предпрослушивание не падает без браузера", async () => {
  const { previewCue, stopPreview } = await import("../src/lib/alert-cues.js");
  assert.equal(previewCue("alarm"), 0);
  assert.doesNotThrow(() => stopPreview());
});
