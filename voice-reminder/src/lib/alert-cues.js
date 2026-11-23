// lib/alert-cues.js — список звуковых сигналов перед напоминанием.
//
// Зачем. Раньше сигнал был один и звучал тихо: шёл через поток уведомлений,
// который на телефоне обычно приглушён. Теперь звук синтезируется в нативном
// слое через поток будильника, а здесь описан список вариантов и их
// предпрослушивание — чтобы можно было выбрать на слух.
//
// Предпрослушивание синтезируется тем же способом, что и настоящий сигнал:
// одинаковые формулы в JS и Java дают одинаковое звучание, поэтому выбор в
// настройках звучит ровно так же, как сработает напоминание.

export const ALERT_CUES = [
  { id: "alarm", label: "Будильник (громкий)" },
  { id: "beep", label: "Три пика (самый заметный)" },
  { id: "bell", label: "Колокол (мягкий)" },
  { id: "chime", label: "Перезвон (спокойный)" },
];

const CUE_RATE = 22050;

/** Синтезирует сигнал так же, как это делает DeliveryService. */
export function cueSamples(kind, rate = CUE_RATE) {
  const amp = 30000;
  switch (kind) {
    case "beep": {
      const total = Math.floor(rate * 0.3);
      const out = new Float32Array(total);
      const on = Math.floor(rate * 0.07);
      const off = Math.floor(rate * 0.03);
      let pos = 0;
      let i = 0;
      while (pos < total) {
        const loud = i % (on + off) < on;
        if (loud) {
          for (let j = 0; j < on && pos < total; j++, pos++) {
            const env = Math.min(1, j / 220) * Math.min(1, (on - j) / 220);
            out[pos] =
              (Math.sin((2 * Math.PI * 1500 * pos) / rate) * amp * env) / 32768;
          }
        } else {
          pos += off;
        }
        i++;
      }
      return out;
    }
    case "bell": {
      const total = Math.floor(rate * 0.6);
      const out = new Float32Array(total);
      const half = Math.floor(total / 2);
      for (let i = 0; i < total; i++) {
        const t = i / rate;
        const env =
          i < half ? Math.exp((-3 * i) / half) : Math.exp((-3 * (i - half)) / half);
        const base = i < half ? 880 : 1175;
        const s =
          Math.sin(2 * Math.PI * base * t) +
          0.35 * Math.sin(2 * Math.PI * base * 2.02 * t);
        out[i] = (s * amp * 0.55 * env) / 32768;
      }
      return out;
    }
    case "chime": {
      const total = Math.floor(rate * 0.45);
      const out = new Float32Array(total);
      const half = Math.floor(total / 2);
      for (let i = 0; i < total; i++) {
        const t = i / rate;
        const base = i < half ? 880 : 1320;
        const env = Math.min(1, i / 300) * Math.min(1, (total - i) / 500);
        out[i] = (Math.sin(2 * Math.PI * base * t) * amp * 0.8 * env) / 32768;
      }
      return out;
    }
    default: {
      // alarm: два тона попеременно, как механический будильник.
      const total = Math.floor(rate * 0.55);
      const out = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        const t = i / rate;
        const freq = Math.floor(t * 12) % 2 === 0 ? 1000 : 1250;
        const env = Math.min(1, i / 400) * Math.min(1, (total - i) / 400);
        const trem = 0.75 + 0.25 * Math.sin(2 * Math.PI * 24 * t);
        out[i] = (Math.sin(2 * Math.PI * freq * t) * amp * env * trem) / 32768;
      }
      return out;
    }
  }
}

/** Длительность сигнала в миллисекундах. */
export function cueDurationMs(kind) {
  return Math.round((cueSamples(kind).length / CUE_RATE) * 1000);
}

let playing = null;

/**
 * Проигрывает сигнал для предпрослушивания.
 *
 * Возвращает длительность в миллисекундах. Повторный вызов останавливает
 * предыдущий звук, чтобы быстрые нажатия не накладывались друг на друга.
 */
export function previewCue(kind) {
  stopPreview();
  if (typeof window === "undefined" || !window.AudioContext) return 0;
  try {
    const ctx = new AudioContext();
    const data = cueSamples(kind, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    playing = { ctx, source };
    source.onended = () => stopPreview();
    return Math.round((data.length / ctx.sampleRate) * 1000);
  } catch {
    return 0;
  }
}

export function stopPreview() {
  if (!playing) return;
  try {
    playing.source.stop();
  } catch {
    /* уже остановлен */
  }
  try {
    playing.ctx.close();
  } catch {
    /* уже закрыт */
  }
  playing = null;
}
