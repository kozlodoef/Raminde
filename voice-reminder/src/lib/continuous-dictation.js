import { startRecognition } from "./speech.js";

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
    } catch (error) {
      launching = false;
      active = null;
      if (aborted || settled) return;
      const message = String(error?.message || error);
      if (stopRequested && /no-speech|aborted/.test(message)) {
        done();
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
