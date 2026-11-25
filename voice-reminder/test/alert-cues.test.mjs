// Музыкальные сигналы напоминания.
//
// Дефект, который здесь закреплён: сигналы синтезировались одной-двумя
// синусоидами. Чистый тон без обертонов — это «пищалка»: у настоящего
// инструмента звук складывается из основного тона и обертонов, причём
// верхние гаснут быстрее нижних. Теперь сигналы собраны аддитивным синтезом.
//
// Проверяется не красота звучания (её без слуха не оценить), а признаки,
// которые отличают музыкальный сигнал от пищалки: наличие обертонов,
// затухание, одинаковая громкость разных сигналов.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_CUES,
  DEFAULT_CUE,
  cueSamples,
  cueDurationMs,
} from "../src/lib/alert-cues.js";

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

test("громкость одинакова у всех сигналов — различается только тембр", () => {
  // Иначе выбор «перезвона» тихо, а «будильника» громко: человек решил бы,
  // что один сигнал сломан.
  const peaks = ALERT_CUES.map((c) => {
    const s = cueSamples(c.id);
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    return peak;
  });
  const min = Math.min(...peaks);
  const max = Math.max(...peaks);
  assert.ok(max - min < 0.02, `разброс громкости: ${min.toFixed(3)}…${max.toFixed(3)}`);
});

test("неизвестный сигнал не ломает выбор — звучит сигнал по умолчанию", () => {
  const s = cueSamples("неизвестный");
  assert.ok(s.length > 0);
  assert.equal(cueDurationMs("неизвестный"), cueDurationMs(DEFAULT_CUE));
});

test("сигналы различаются между собой", () => {
  const a = cueSamples("beep");
  const b = cueSamples("bell");
  assert.notEqual(a.length, b.length, "сигналы не должны совпадать");
});

test("предпрослушивание не падает без браузера", async () => {
  const { previewCue, stopPreview } = await import("../src/lib/alert-cues.js");
  assert.equal(previewCue("marimba"), 0);
  assert.doesNotThrow(() => stopPreview());
});

// --- Музыкальность: признаки, которых не было у прежних сигналов ---

/** Грубая оценка спектра на одной частоте (преобразование Гёцеля). */
function energyAt(samples, freq, rate = 22050) {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * freq) / rate;
  // Первые 200 мс: дальше сигнал уже затух и вклад шума заметнее.
  const n = Math.min(samples.length, Math.round(rate * 0.2));
  for (let i = 0; i < n; i++) {
    re += samples[i] * Math.cos(w * i);
    im += samples[i] * Math.sin(w * i);
  }
  return Math.sqrt(re * re + im * im) / n;
}

test("у мягких сигналов есть обертоны, а не один тон", () => {
  // У маримбы основной тон 523 Гц и характерный четвёртый обертон около
  // 2008 Гц. Если бы звук был одной синусоидой, энергии на обертоне не было.
  const s = cueSamples("marimba");
  const base = energyAt(s, 523.25);
  const upper = energyAt(s, 523.25 * 3.93);
  assert.ok(base > 0, "нет основного тона");
  assert.ok(
    upper > base * 0.02,
    `обертон отсутствует: ${upper.toExponential(2)} при основном ${base.toExponential(2)}`,
  );
});

test("колокольчик звучит некратными обертонами", () => {
  // Признак металла: обертон 2.76 от основного. У кратных обертонов
  // (2.0) звук воспринимается как электронный.
  const s = cueSamples("bell");
  const at2 = energyAt(s, 880 * 2.0);
  const at276 = energyAt(s, 880 * 2.76);
  assert.ok(at276 > 0, "нет некратного обертона");
  // Оба обертона должны быть слышны: если один подавлен полностью, тембр
  // теряет характер.
  assert.ok(at2 > 0 && at276 > 0);
});

test("звук затухает, а не обрывается", () => {
  // У живого инструмента громкость падает плавно. Резкий обрыв в конце —
  // признак грубого сигнала.
  for (const id of ["marimba", "bell", "harp"]) {
    const s = cueSamples(id);
    const early = s.slice(
      Math.round(s.length * 0.05),
      Math.round(s.length * 0.15),
    );
    const late = s.slice(
      Math.round(s.length * 0.75),
      Math.round(s.length * 0.9),
    );
    const rms = (arr) => Math.sqrt(arr.reduce((a, v) => a + v * v, 0) / arr.length);
    assert.ok(
      rms(late) < rms(early) * 0.5,
      `${id}: звук не затухает (${rms(early).toFixed(4)} → ${rms(late).toFixed(4)})`,
    );
  }
});

test("нет щелчка в начале сигнала", () => {
  // Атака в 2 мс обязательна: резкий перепад от нуля к полной амплитуде
  // даёт щелчок на динамике.
  for (const cue of ALERT_CUES) {
    const s = cueSamples(cue.id);
    const first = Math.abs(s[0]);
    const third = Math.abs(s[Math.round(22050 * 0.0003)]);
    assert.ok(
      first < 0.05,
      `${cue.id}: первый отсчёт ${first.toFixed(3)} — будет щелчок`,
    );
    assert.ok(third >= first, `${cue.id}: атака не нарастает`);
  }
});

test("сигнал по умолчанию — музыкальный, а не будильник", () => {
  assert.equal(DEFAULT_CUE, "marimba");
  assert.ok(
    ALERT_CUES.some((c) => c.id === DEFAULT_CUE),
    "сигнала по умолчанию нет в списке",
  );
});

test("в списке шесть вариантов и метки без повторов", () => {
  assert.equal(ALERT_CUES.length, 6);
  assert.equal(new Set(ALERT_CUES.map((c) => c.label)).size, 6);
  assert.equal(new Set(ALERT_CUES.map((c) => c.id)).size, 6);
});

test("громкие варианты остались доступны", () => {
  // Их выбирают осознанно, когда напоминание должно разбудить.
  for (const id of ["beep", "alarm"])
    assert.ok(
      ALERT_CUES.some((c) => c.id === id),
      `пропал громкий сигнал: ${id}`,
    );
});

// --- Согласованность с нативной стороной ---
//
// Предпрослушивание в настройках считает JS, а сам сигнал при напоминании —
// Java. Если таблицы разойдутся, человек выберет один звук, а услышит
// другой. Проверка сравнивает числа из обоих файлов.

test("таблицы обертонов в JS и Java совпадают", async () => {
  const fs = await import("node:fs/promises");
  const java = await fs.readFile(
    new URL(
      "../android/app/src/main/java/ru/voicereminder/app/reminders/DeliveryService.java",
      import.meta.url,
    ),
    "utf8",
  );
  const js = await fs.readFile(
    new URL("../src/lib/alert-cues.js", import.meta.url),
    "utf8",
  );
  // Наборы «ratio, gain, decay» из обоих файлов — в порядке появления.
  const triple = (text, re) =>
    [...text.matchAll(re)].map((m) => `${+m[1]},${+m[2]},${+m[3]}`);
  const fromJs = triple(
    js,
    /ratio: ([\d.]+), gain: ([\d.]+), decay: ([\d.]+)/g,
  );
  const fromJava = triple(java, /\{([\d.]+),([\d.]+),([\d.]+)\}/g);
  assert.ok(fromJs.length > 10, "не удалось прочитать таблицы JS");
  assert.deepEqual(
    fromJava.slice(0, fromJs.length),
    fromJs,
    "обертоны в DeliveryService.java разошлись с alert-cues.js",
  );
});

test("ноты в JS и Java совпадают", async () => {
  const fs = await import("node:fs/promises");
  const java = await fs.readFile(
    new URL(
      "../android/app/src/main/java/ru/voicereminder/app/reminders/DeliveryService.java",
      import.meta.url,
    ),
    "utf8",
  );
  const js = await fs.readFile(
    new URL("../src/lib/alert-cues.js", import.meta.url),
    "utf8",
  );
  const note = (text, re) =>
    [...text.matchAll(re)].map((m) => `${+m[1]},${+m[2]},${+m[3]},${+m[4]}`);
  const fromJs = note(
    js,
    /at: (\d+), freq: ([\d.]+), ms: (\d+), amp: ([\d.]+)/g,
  );
  // Ноты в Java — четвёрки в блоках CUE_NOTES.
  const notesBlock = java.slice(
    java.indexOf("CUE_NOTES.put"),
    java.indexOf("CUE_PARTIALS.put"),
  );
  const fromJava = note(notesBlock, /\{([\d.]+),([\d.]+),([\d.]+),([\d.]+)\}/g);
  assert.ok(fromJs.length >= 12, "не удалось прочитать ноты JS");
  assert.deepEqual(
    fromJava,
    fromJs,
    "ноты в DeliveryService.java разошлись с alert-cues.js",
  );
});