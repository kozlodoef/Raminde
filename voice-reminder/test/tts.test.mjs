// Тесты модуля озвучки (lib/tts.js).
//
// Проверяем именно обходы дефектов Web Speech API — то, ради чего модуль
// и появился. Браузера здесь нет, поэтому speechSynthesis подменяется
// заглушкой, которая ведёт себя как настоящий Chrome в проблемных случаях.
import test from "node:test";
import assert from "node:assert/strict";

// Заглушка speechSynthesis: запоминает вызовы и позволяет управлять голосами.
function installFakeSynth({ voices = [], voicesAfterEvent = null } = {}) {
  const calls = { speak: [], cancel: 0, listeners: 0 };
  let currentVoices = voices;

  const synth = {
    getVoices: () => currentVoices,
    speak: (u) => {
      calls.speak.push(u);
      // Вызываем onend асинхронно, как настоящий синтезатор.
      setTimeout(() => u.onend && u.onend(), 0);
    },
    cancel: () => {
      calls.cancel++;
    },
    speaking: false,
    pause: () => {},
    resume: () => {},
    addEventListener: (name, fn) => {
      if (name !== "voiceschanged") return;
      calls.listeners++;
      if (voicesAfterEvent) {
        setTimeout(() => {
          currentVoices = voicesAfterEvent;
          fn();
        }, 0);
      }
    },
    removeEventListener: () => {},
  };

  globalThis.window = globalThis.window || {};
  globalThis.window.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };

  return { synth, calls };
}

function cleanup() {
  delete globalThis.window?.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

test("ttsAvailable сообщает о наличии синтезатора", async () => {
  const { ttsAvailable } = await import("../src/lib/tts.js");
  cleanup();
  assert.equal(ttsAvailable(), false, "без speechSynthesis озвучки нет");
  installFakeSynth();
  assert.equal(ttsAvailable(), true);
  cleanup();
});

test("speak пропускает пустой текст и не зовёт синтезатор", async () => {
  const { speak } = await import("../src/lib/tts.js");
  const { calls } = installFakeSynth();
  let ended = false;
  const r = speak("   ", { onend: () => (ended = true) });
  assert.equal(r, false);
  assert.equal(ended, true, "onend всё равно должен быть вызван");
  assert.equal(calls.speak.length, 0, "пустой текст не озвучивается");
  cleanup();
});

test("speak берёт русский голос, даже если список пришёл позже", async () => {
  const { speak } = await import("../src/lib/tts.js");
  // Первый getVoices() пуст — как в настоящем Chrome при старте.
  const en = { lang: "en-US", name: "English" };
  const ru = { lang: "ru-RU", name: "Русский" };
  const { calls } = installFakeSynth({
    voices: [],
    voicesAfterEvent: [en, ru],
  });

  speak("Пора вспомнить");
  // Ждём: задержка 60 мс + ожидание голосов.
  await new Promise((r) => setTimeout(r, 1500));

  assert.equal(calls.speak.length, 1, "фраза должна быть произнесена");
  assert.equal(
    calls.speak[0].voice?.name,
    "Русский",
    "должен выбраться русский голос, а не английский",
  );
  cleanup();
});

test("speak отменяет предыдущую фразу перед новой", async () => {
  const { speak } = await import("../src/lib/tts.js");
  const { calls } = installFakeSynth({ voices: [{ lang: "ru-RU", name: "Р" }] });
  speak("первая");
  await new Promise((r) => setTimeout(r, 100));
  speak("вторая");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(calls.cancel >= 2, "cancel должен вызываться перед каждой фразой");
  cleanup();
});

test("cancelSpeech безопасен без синтезатора", async () => {
  const { cancelSpeech } = await import("../src/lib/tts.js");
  cleanup();
  // Не должно бросать: функция вызывается при размонтировании компонента.
  assert.doesNotThrow(() => cancelSpeech());
});
