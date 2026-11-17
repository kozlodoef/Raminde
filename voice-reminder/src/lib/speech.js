// lib/speech.js — распознавание речи в двух средах.
//
// Браузер: Web Speech API (SpeechRecognition) — распознавание идёт в облаке
//          Google/Apple, то есть фактически тоже ИИ.
// Android: нативный плагин @capacitor-community/speech-recognition.
//          В WebView SpeechRecognition не поддерживается, поэтому без плагина
//          микрофон в приложении просто не работал бы.
//
// Наружу отдаём один и тот же контракт: startRecognition() → { promise, stop, abort }.
// Статически нативные модули НЕ импортируем: в браузере они не нужны и грузились бы зря.
import { isNative } from "./native.js";

const DEMO_PHRASES = [
  "Напомни мне завтра в семь утра полить цветы",
  "Напомнить через два часа позвонить маме",
  "Напомни в пятницу вечером купить подарок",
  "Напомни 15 октября в 10 утра сдать отчёт",
  "Напомни сегодня без четверти шесть забрать ребёнка из школы",
];

export function demoPhrase() {
  return DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
}

function getRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  if (isNative()) return true; // нативный плагин почти всегда доступен
  return !!getRecognitionCtor();
}

export async function hasMicPermission() {
  if (!isNative()) return true;
  try {
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
    const st = await SpeechRecognition.checkPermissions();
    return st?.speechRecognition === "granted";
  } catch (e) {
    console.warn("Проверка разрешения не удалась:", e);
    return false;
  }
}

export async function requestMicPermission() {
  if (!isNative()) return true;
  try {
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
    const avail = await SpeechRecognition.available();
    if (!avail?.available) return false;
    const st = await SpeechRecognition.requestPermissions();
    return st?.speechRecognition === "granted";
  } catch (e) {
    console.warn("Запрос разрешения не удался:", e);
    return false;
  }
}

// ---------------------------------------------------------------- нативный ---

async function startNative({ lang, onInterim, onEnd, onError, onStart }) {
  const { registerPlugin } = await import("@capacitor/core");
  const engine = registerPlugin("ReminderEngine");
  const partial = await engine.addListener("recognitionPartial", (e) => onInterim?.(e.text));
  const state = await engine.addListener("recognitionState", (e) => {
    // Статусы "started"/"stopped" приходят и при внутреннем перезапуске
    // распознавания. Кнопкой управляет JS, поэтому здесь ничего не делаем.
  });

  let ended = false;
  const cleanup = async () => {
    await partial.remove().catch(() => {});
    await state.remove().catch(() => {});
    if (!ended) {
      ended = true;
      onEnd?.();
    }
  };

  const promise = engine
    .recognize({ language: lang || "ru-RU" })
    .then((r) => r.text || "")
    .catch((e) => {
      onError?.(e.message);
      throw e;
    })
    .finally(cleanup);

  // Запись завершается только действием пользователя («Готово»),
  // поэтому автоматический таймаут здесь не нужен.
  return {
    promise,
    stop: () => engine.stopRecognition(),
    abort: () => engine.abortRecognition(),
  };
}

// ---------------------------------------------------------------- браузерная ---

function startWeb({ lang, onInterim, onEnd, onError, onStart }) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return {
      promise: Promise.reject(new Error("unsupported")),
      stop: () => {},
      abort: () => {},
    };
  }

  const rec = new Ctor();
  rec.lang = lang || "ru-RU";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    rec.onstart = () => onStart && onStart();
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (onInterim) onInterim((finalText + " " + interim).trim());
    };
    rec.onerror = (e) => {
      // Пауза или тишина — не повод прекращать запись.
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (!settled) {
        settled = true;
        onError && onError(e.error);
        reject(new Error(e.error || "speech-error"));
      }
    };
    rec.onend = () => {
      settled = true;
      onEnd && onEnd();
      resolve(finalText.trim());
    };
    try {
      rec.start();
    } catch (err) {
      settled = true;
      reject(err);
    }
  });

  const finish = () => {
    try {
      rec.stop();
    } catch (_) {}
  };

  return {
    promise,
    stop: finish,
    abort: () => {
      settled = true;
      try {
        rec.abort();
      } catch (_) {}
    },
  };
}

export async function startRecognition(opts = {}) {
  return isNative() ? startNative(opts) : startWeb(opts);
}