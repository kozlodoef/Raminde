// Stop recording, then wait for the final parsing task. Never save an interim transcript.
export async function finishDictation({ task, session, timeoutMs = 12000 }) {
  if (!task) throw Error('Не удалось завершить запись. Повторите диктовку.');
  let stopped = false, poll, timeout;
  const stop = () => {
    const current = session();
    if (!current || stopped) return;
    stopped = true;
    Promise.resolve().then(() => current.stop()).catch(() => {});
  };
  stop();
  poll = setInterval(stop, 25);
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const current = session();
          Promise.resolve().then(() => current?.abort()).catch(() => {});
          reject(Error('Распознавание не завершилось. Напоминание не сохранено. Повторите диктовку или введите текст вручную.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearInterval(poll);
    clearTimeout(timeout);
  }
}
