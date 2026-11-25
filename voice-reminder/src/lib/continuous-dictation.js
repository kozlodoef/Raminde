import { startRecognition } from "./speech.js";

/**
 * Убирает «эхо» — короткие обрывки, которые движок выдаёт на тишине.
 *
 * Модель, которой подсунули ровный шум, всё равно возвращает какое-нибудь
 * слово: «включи», «и», «на». Главная защита стоит в нативном слое (фрагмент
 * без речи не отправляется на распознавание), но здесь добавлен последний
 * фильтр: настоящая фраза напоминания содержит смысл, а не одно служебное
 * слово. Это дешёвая страховка для веб-версии и для системного движка.
 */
const FILLER = new Set([
  "и", "а", "в", "во", "на", "с", "со", "у", "о", "об", "ну", "да", "нет",
  "не", "то", "э", "ээ", "эм", "мм", "ох", "ах", "так", "вот", "или",
  "включи", "выключи", "стоп", "отмена",
]);

/** Осмысленный ли обрывок: не одно служебное слово и не пустышка. */
export function isMeaningfulSegment(segment) {
  const words = String(segment || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  if (!words.length) return false;
  // Достаточно одного слова, которого нет в списке служебных: «хлеб» и
  // «позвонить» — настоящая речь, а «включи» и «и» — нет. Длину слова не
  // проверяем: короткие существительные («чай», «сок») тоже бывают командой,
  // а шум модели почти всегда попадает в служебные слова.
  return words.some((w) => !FILLER.has(w));
}

// The OS recognizer may finish at a pause. Only stop()/abort() end this logical session.
// Raw microphone continuity is not guaranteed by Android's system speech service.
export function startContinuousDictation({
  onStart,
  onInterim,
  onFinal,
  onWaiting,
  start = startRecognition,
  shouldContinue = () => typeof document === "undefined" || !document.hidden,
  restartDelayMs = 250,
  restartOnEnd = true,
} = {}) {
  let active = null,
    launching = false,
    stopRequested = false,
    aborted = false,
    settled = false,
    timer,
    first = true,
    text = "",
    lastSegment = "",
    failures = 0;
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const done = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(aborted ? "" : text);
  };
  const append = (segment) => {
    segment = segment?.trim();
    if (!segment || segment === lastSegment) return;
    // Обрывки, которые движок выдал на тишине, в текст не пускаем.
    if (!isMeaningfulSegment(segment)) return;
    text = [text, segment].filter(Boolean).join(" ");
    lastSegment = segment;
    onFinal?.(text);
  };
  async function cycle() {
    if (settled || aborted || stopRequested) {
      done();
      return;
    }
    if (!shouldContinue()) {
      aborted = true;
      done();
      return;
    }
    launching = true;
    try {
      const session = await start({
        cue: first,
        onStart: () => !settled && !aborted && onStart?.(),
        onInterim: (t) =>
          !settled &&
          !aborted &&
          onInterim?.([text, t?.trim()].filter(Boolean).join(" ")),
      });
      first = false;
      launching = false;
      active = session;
      if (aborted || settled) {
        await session.abort();
        return;
      }
      if (stopRequested) await session.stop();
      const result = await session.promise;
      active = null;
      if (aborted || settled) return;
      append(result);
      failures = 0;
      if (!restartOnEnd) {
        onWaiting?.();
        done();
        return;
      }
    } catch (error) {
      launching = false;
      active = null;
      if (aborted || settled) return;
      const message = String(error?.message || error);
      if (stopRequested && /no-speech|aborted/.test(message)) {
        done();
        return;
      }
      if (!restartOnEnd && /no-speech/.test(message)) {
        onWaiting?.();
        return;
      }
      if (
        /not-allowed|unsupported|service-not-allowed|language-not-supported/.test(
          message,
        )
      ) {
        done(error);
        return;
      }
      if (!/no-speech/.test(message) && ++failures >= 3) {
        done(error);
        return;
      }
    }
    if (stopRequested) {
      done();
      return;
    }
    if (!shouldContinue()) {
      aborted = true;
      done();
      return;
    }
    onWaiting?.();
    timer = setTimeout(cycle, restartDelayMs);
  }
  queueMicrotask(cycle);
  return {
    promise,
    stop() {
      if (settled) return;
      stopRequested = true;
      clearTimeout(timer);
      if (active)
        Promise.resolve()
          .then(() => active?.stop())
          .catch(done);
      else if (!launching) done();
    },
    abort() {
      if (settled) return;
      aborted = true;
      clearTimeout(timer);
      if (active)
        Promise.resolve()
          .then(() => active?.abort())
          .catch(() => {});
      done();
    },
  };
}
