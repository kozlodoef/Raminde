// lib/vosk.js — офлайн-распознавание речи на Vosk.
//
// Главное отличие от системного SpeechRecognizer: запись не прерывается
// таймаутом тишины. Сессия живёт до вызова stop()/abort().
//
// Контракт совпадает с startRecognition() из speech.js:
//   { promise, stop, abort }
import { registerPlugin } from "@capacitor/core";

const VoskRecognition = registerPlugin("VoskRecognition");

let prepared = null;

/** Готовит модель. Первый запуск копирует её из assets (~87 МБ). */
export function prepareVosk() {
  if (!prepared) {
    prepared = VoskRecognition.prepare().catch((error) => {
      prepared = null;
      throw error;
    });
  }
  return prepared;
}

/** Сбросить кэш готовности (для повторной попытки после ошибки). */
export function resetVosk() {
  prepared = null;
}

/**
 * Запускает распознавание до явной остановки.
 * onInterim(text) получает накопленный текст по мере распознавания.
 */
export async function startVosk({ onInterim, onEnd, onError, onStart } = {}) {
  await prepareVosk();

  const listener = await VoskRecognition.addListener("partial", (event) => {
    onInterim?.(event.text || "");
  });

  let finish = null;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  let settled = false;
  const settle = (value) => {
    if (settled) return;
    settled = true;
    finish(value);
  };

  const cleanup = async () => {
    await listener.remove().catch(() => {});
    onEnd?.();
  };

  const promise = VoskRecognition.start()
    .then(() => {
      onStart?.();
      return result;
    })
    .catch((error) => {
      onError?.(error.message);
      throw error;
    })
    .finally(cleanup);

  return {
    promise,
    stop: async () => {
      try {
        const stopped = await VoskRecognition.stop();
        settle(stopped?.text || "");
      } catch (error) {
        onError?.(error.message);
        settle("");
      }
    },
    abort: async () => {
      try {
        await VoskRecognition.abort();
      } catch (_) {}
      settle("");
    },
  };
}

/** Доступен ли Vosk в текущей среде (только нативное приложение). */
export function isVoskSupported() {
  return typeof window !== "undefined" && !!window.Capacitor?.Plugins?.VoskRecognition;
}
