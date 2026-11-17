// lib/vosk.js — прототип офлайн-распознавания на Vosk.
//
// Отличие от системного SpeechRecognizer: нет таймаута тишины, запись идёт
// столько, сколько нужно, до явной остановки.
import { registerPlugin } from "@capacitor/core";

const VoskRecognition = registerPlugin("VoskRecognition");

/** Готовит модель во внутреннем хранилище (первый запуск копирует ~87 МБ). */
export async function prepareVosk() {
  return VoskRecognition.prepare();
}

/**
 * Запускает распознавание.
 * Возвращает { promise, stop, abort } — тот же контракт, что и startRecognition().
 */
export async function startVosk({ onInterim, onEnd, onError } = {}) {
  await prepareVosk();

  const listener = await VoskRecognition.addListener("partial", (event) => {
    onInterim?.(event.text || "");
  });

  let finished = false;
  const promise = VoskRecognition.start()
    .then(() => new Promise((resolve) => {
      // Разрешается при остановке через stopVosk()/abortVosk().
      resolveStop = resolve;
    }))
    .catch((error) => {
      onError?.(error.message);
      throw error;
    })
    .finally(async () => {
      finished = true;
      await listener.remove().catch(() => {});
      onEnd?.();
    });

  let resolveStop;
  const handle = {
    promise,
    stop: async () => {
      const result = await VoskRecognition.stop();
      if (!finished) resolveStop?.(result.text || "");
    },
    abort: async () => {
      await VoskRecognition.abort();
      if (!finished) resolveStop?.("");
    },
  };
  return handle;
}
