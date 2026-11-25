// lib/ui-sounds.js — короткие звуки действий в интерфейсе.
//
// Зачем отдельный модуль. Это не сигналы напоминаний (за них отвечает
// lib/alert-cues.js и нативный слой): здесь только тихие отклики на действия
// человека — удаление, изменение, переключение. Они нужны, чтобы нажатие
// ощущалось сделанным, особенно когда карточка исчезает с экрана.
//
// Все звуки синтезируются: приложение работает офлайн, файлов со звуками в
// сборке нет. Длительность держим короткой (60–220 мс), иначе частые нажатия
// превращаются в шум.

let audioCtx = null;
// Когда последний раз звучал осмысленный отклик (удаление, подтверждение).
// Нужен, чтобы щелчок нажатия не накладывался на него.
let lastMeaningful = 0;

function ctx() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/**
 * Проигрывает короткий тон.
 * Огибающая обязательна: без неё на границе тона слышен щелчок.
 */
function tone(c, { freq, at, dur, type = "sine", gain = 0.1 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.03);
}

const SOUNDS = {
  // Удаление: короткий нисходящий тон — «убрали».
  delete: [
    { freq: 620, dur: 0.1 },
    { freq: 420, dur: 0.14, delay: 0.09 },
  ],
  // Изменение: восходящий — «поменяли».
  edit: [
    { freq: 520, dur: 0.09 },
    { freq: 780, dur: 0.12, delay: 0.08 },
  ],
  // Переключение: одиночный мягкий щелчок.
  toggle: [{ freq: 880, dur: 0.07 }],
  // Щелчок крутилки времени: короткий сухой звук на каждой остановке.
  // Частоту держим невысокой, а длительность совсем короткой — при быстрой
  // прокрутке такие щелчки сливаются в треск, а не в писк.
  tick: [{ freq: 1250, dur: 0.018, type: "square", gain: 0.045 }],
  // Подтверждение: два тона вверх, как у «готово».
  confirm: [
    { freq: 660, dur: 0.1 },
    { freq: 990, dur: 0.16, delay: 0.1 },
  ],
  // Смена месяца: лёгкий шелест вверх — «перелистнули».
  // Два близких тона подряд читаются как движение, но не как сигнал.
  month: [
    { freq: 520, dur: 0.06, gain: 0.055 },
    { freq: 700, dur: 0.08, delay: 0.05, gain: 0.05 },
  ],
  // Нажатие кнопки: самый короткий и тихий отклик.
  // Нужен там, где действие не меняет ничего видимого — открыть, переключить.
  press: [{ freq: 1040, dur: 0.028, type: "triangle", gain: 0.05 }],
};

/**
 * Проигрывает звук действия.
 *
 * Ничего не возвращает и никогда не бросает: звук — украшение, и его сбой не
 * должен мешать удалить напоминание. Если звук отключён настройкой или
 * недоступен, просто молчим.
 */
export function playUiSound(kind, { enabled = true } = {}) {
  if (!enabled) return;
  const c = ctx();
  if (!c || c.state !== "running") return;
  const notes = SOUNDS[kind];
  if (!notes) return;
  // Щелчок нажатия не должен звучать поверх осмысленного отклика: если только
  // что прозвучало удаление или подтверждение, лишний щелчок — просто шум.
  if (kind === "press") {
    if (Date.now() - lastMeaningful < 150) return;
  } else lastMeaningful = Date.now();
  try {
    const t = c.currentTime;
    for (const n of notes)
      tone(c, {
        freq: n.freq,
        at: t + (n.delay || 0),
        dur: n.dur,
        type: n.type || "sine",
        gain: n.gain ?? 0.09,
      });
  } catch {
    /* нет звука — не беда */
  }
}

/** Доступные звуки — для настроек и тестов. */
export const UI_SOUNDS = Object.keys(SOUNDS);
