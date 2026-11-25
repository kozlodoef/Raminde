// lib/alert-cues.js — музыкальные сигналы напоминания.
//
// Почему переписано. Раньше сигналы синтезировались одной-двумя синусоидами.
// Чистый тон без обертонов — это и есть «пищалка»: у настоящего инструмента
// звук складывается из основного тона и обертонов, причём верхние гаснут
// быстрее нижних. Именно это отличает маримбу от сигнала таймера.
//
// Здесь каждый сигнал собран аддитивным синтезом: набор обертонов с разной
// громкостью и разной скоростью затухания, плюс ударная атака в несколько
// миллисекунд. У колокольчика обертоны некратные (2.76, 5.4 — как у настоящего
// колокола), у маримбы кратный четвёртый обертон, у арфы равноотстоящий ряд.
//
// Готовые музыкальные файлы сознательно не берём: у них чужая лицензия, а для
// RuStore нужен звук, права на который принадлежат проекту. Синтез даёт
// собственный звук без внешних файлов, без интернета и без роста размера
// приложения.
//
// Одинаковые формулы в JS (предпрослушивание) и Java (сам сигнал) дают
// одинаковое звучание: выбор в настройках звучит ровно так же, как сработает
// напоминание. При правке любой таблицы её надо повторить в
// DeliveryService.java — там те же числа и тот же порядок вычислений.

export const ALERT_CUES = [
  { id: "marimba", label: "Маримба (музыкальный)" },
  { id: "bell", label: "Колокольчик (мягкий)" },
  { id: "harp", label: "Арфа (перелив)" },
  { id: "chime", label: "Перезвон (спокойный)" },
  { id: "beep", label: "Три пика (самый заметный)" },
  { id: "alarm", label: "Будильник (громкий)" },
];

/**
 * Сигнал по умолчанию.
 *
 * Раньше это был «будильник»: два резких тона попеременно. Именно его
 * слышал новый пользователь первым. Для напоминания о деле такой звук
 * слишком грубый — он годится, чтобы разбудить. Маримба звучит как
 * музыкальная фраза, а громкие варианты остались в списке для тех, кому
 * нужно именно разбудить.
 */
export const DEFAULT_CUE = "marimba";

const CUE_RATE = 22050;

// Общая громкость всех сигналов: пик приводится к этому значению, чтобы
// сигналы не различались громкостью — только тембром.
const PEAK = 0.85;

/**
 * Наборы обертонов.
 *
 * ratio — во сколько раз обертон выше основного тона;
 * gain  — громкость относительно основного;
 * decay — скорость затухания в 1/с (больше — гаснет быстрее).
 *
 * Верхние обертоны всегда гаснут быстрее: без этого звук становится
 * «органным» и неестественно тянется.
 */
const TIMBRES = {
  // Маримба: деревянный удар. Характерный признак — сильный четвёртый
  // обертон (ratio 4) и очень короткое звучание.
  marimba: [
    { ratio: 1, gain: 1.0, decay: 8 },
    { ratio: 3.93, gain: 0.26, decay: 15 },
    { ratio: 9.24, gain: 0.07, decay: 28 },
  ],
  // Колокольчик: обертоны некратные — так звучит металл. Ровно кратные дают
  // ощущение «электронного» звука.
  bell: [
    { ratio: 1.0, gain: 1.0, decay: 4.2 },
    { ratio: 2.0, gain: 0.42, decay: 5.6 },
    { ratio: 2.76, gain: 0.3, decay: 6.8 },
    { ratio: 5.4, gain: 0.15, decay: 9.5 },
    { ratio: 8.93, gain: 0.07, decay: 13 },
  ],
  // Арфа: щипок струны. Ровный ряд обертонов с быстрым затуханием верхних.
  harp: [
    { ratio: 1, gain: 1.0, decay: 4.5 },
    { ratio: 2, gain: 0.45, decay: 6.5 },
    { ratio: 3, gain: 0.22, decay: 9 },
    { ratio: 4, gain: 0.12, decay: 12 },
    { ratio: 5, gain: 0.06, decay: 16 },
  ],
  // Перезвон: мягкий, почти без верхних обертонов — спокойный вариант.
  chime: [
    { ratio: 1, gain: 1.0, decay: 5 },
    { ratio: 2, gain: 0.22, decay: 8 },
    { ratio: 3, gain: 0.08, decay: 12 },
  ],
  // Писк: намеренно резкий. Верхние обертоны придают «колючесть», но без них
  // сигнал на 1500 Гц звучит как из динамика будильника 90-х.
  beep: [
    { ratio: 1, gain: 1.0, decay: 3 },
    { ratio: 2, gain: 0.3, decay: 5 },
    { ratio: 3, gain: 0.12, decay: 8 },
  ],
  // Будильник: два тона попеременно с трелью. Обертоны дают «механичность».
  alarm: [
    { ratio: 1, gain: 1.0, decay: 2.5 },
    { ratio: 2, gain: 0.35, decay: 4 },
    { ratio: 3, gain: 0.14, decay: 6 },
  ],
};

// Ноты: at — когда начать (мс), freq — частота (Гц), ms — сколько звучит,
// amp — громкость ноты относительно остальных.
const NOTES = {
  // Маримба: до — соль, восходящая терция-квинта. Узнаваемо и не навязчиво.
  marimba: [
    { at: 0, freq: 523.25, ms: 320, amp: 0.9 },
    { at: 130, freq: 783.99, ms: 620, amp: 1.0 },
  ],
  // Колокольчик: удар по одному тону, второй — отзвук.
  bell: [
    { at: 0, freq: 880.0, ms: 620, amp: 1.0 },
    { at: 90, freq: 1174.66, ms: 520, amp: 0.45 },
  ],
  // Арфа: до — ми — соль, короткий перелив. Интервалы чистые, поэтому
  // звучит как аккорд, а не как случайный набор.
  harp: [
    { at: 0, freq: 523.25, ms: 480, amp: 0.8 },
    { at: 95, freq: 659.25, ms: 480, amp: 0.75 },
    { at: 190, freq: 783.99, ms: 700, amp: 0.9 },
  ],
  // Перезвон: две ноты через октаву, мягко.
  chime: [
    { at: 0, freq: 880.0, ms: 420, amp: 0.8 },
    { at: 150, freq: 1318.51, ms: 620, amp: 1.0 },
  ],
  // Три пика: три коротких сигнала одинаковой высоты.
  beep: [
    { at: 0, freq: 1500.0, ms: 110, amp: 1.0 },
    { at: 140, freq: 1500.0, ms: 110, amp: 1.0 },
    { at: 280, freq: 1500.0, ms: 110, amp: 1.0 },
  ],
  // Будильник: длинный сигнал из двух чередующихся тонов с трелью.
  alarm: [
    { at: 0, freq: 1000.0, ms: 180, amp: 1.0 },
    { at: 180, freq: 1250.0, ms: 180, amp: 1.0 },
    { at: 360, freq: 1000.0, ms: 180, amp: 0.9 },
  ],
};

// Трель: у будильника звук должен «дрожать», иначе он сливается в один тон.
const TREMOLO = { alarm: { hz: 26, depth: 0.22 } };

/** Длительность сигнала в миллисекундах (для паузы перед речью). */
export function cueDurationMs(kind) {
  const notes = NOTES[kind] || NOTES[DEFAULT_CUE];
  const total = Math.max(...notes.map((n) => n.at + n.ms));
  return Math.round(total);
}

/**
 * Синтезирует сигнал.
 *
 * Возвращает Float32Array в диапазоне [-1, 1] с частотой rate. Пик
 * нормируется к PEAK, поэтому громкость всех сигналов одинакова и
 * различаются они только тембром.
 */
export function cueSamples(kind, rate = CUE_RATE) {
  // Неизвестное значение (старая настройка, мусор в хранилище) звучит как
  // сигнал по умолчанию, а не как будильник: если человек однажды выбрал
  // мягкий сигнал, а запись испортилась, будить его резким тоном нельзя.
  const key = NOTES[kind] ? kind : DEFAULT_CUE;
  const notes = NOTES[key];
  const partials = TIMBRES[key] || TIMBRES.alarm;
  const tremolo = TREMOLO[key];

  const totalMs = cueDurationMs(key);
  const total = Math.round((totalMs / 1000) * rate);
  const out = new Float64Array(total);

  // Атака в 2 мс: без неё начало ноты даёт щелчок — резкий перепад
  // громкости от нуля к полной амплитуде.
  const attack = Math.max(1, Math.round(rate * 0.002));
  const nyquist = rate / 2;

  for (const note of notes) {
    const start = Math.round((note.at / 1000) * rate);
    const length = Math.round((note.ms / 1000) * rate);
    for (const p of partials) {
      const freq = note.freq * p.ratio;
      // Обертон выше половины частоты дискретизации не воспроизведётся —
      // пропускаем, иначе получим наложение зеркальной частоты.
      if (freq >= nyquist) continue;
      const w = (2 * Math.PI * freq) / rate;
      for (let i = 0; i < length; i++) {
        const idx = start + i;
        if (idx >= total) break;
        const t = i / rate;
        // Затухание каждого обертона своё: верхние гаснут первыми, поэтому
        // звук с течением времени «темнеет» — так ведут себя живые
        // инструменты.
        const env = Math.exp(-t * p.decay) * (i < attack ? i / attack : 1);
        out[idx] += Math.sin(w * i) * note.amp * p.gain * env;
      }
    }
  }

  // Трель накладывается после смешивания: она модулирует весь сигнал, а не
  // отдельные обертоны.
  if (tremolo) {
    for (let i = 0; i < total; i++) {
      const t = i / rate;
      out[i] *= 1 - tremolo.depth + tremolo.depth * Math.sin(2 * Math.PI * tremolo.hz * t);
    }
  }

  // Нормировка по пику: сигналы должны различаться тембром, а не громкостью.
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  const scale = peak > 0 ? PEAK / peak : 0;
  const result = new Float32Array(total);
  for (let i = 0; i < total; i++) result[i] = out[i] * scale;
  return result;
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