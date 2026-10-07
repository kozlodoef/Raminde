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
import { isNative } from './native.js';

const DEMO_PHRASES = [
  'Напомни мне завтра в семь утра полить цветы',
  'Напомнить через два часа позвонить маме',
  'Напомни в пятницу вечером купить подарок',
  'Напомни 15 октября в 10 утра сдать отчёт',
  'Напомни сегодня без четверти шесть забрать ребёнка из школы',
];

export function demoPhrase() {
  return DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
}

// ---------------------------------------------------------------- браузер ---

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Доступен ли голосовой ввод в текущей среде. */
export function isVoiceSupported() {
  if (isNative()) return true;          // нативный плагин почти всегда доступен
  return !!getRecognitionCtor();
}

/** Уже выданное разрешение на микрофон (только для нативной среды). */
export async function hasMicPermission() {
  if (!isNative()) return true;
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    const st = await SpeechRecognition.checkPermissions();
    return st?.speechRecognition === 'granted';
  } catch (e) {
    console.warn('Проверка разрешения не удалась:', e);
    return false;
  }
}

/** Запросить разрешение на микрофон (нативная среда). */
export async function requestMicPermission() {
  if (!isNative()) return true;
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    const avail = await SpeechRecognition.available();
    if (!avail?.available) return false;
    const st = await SpeechRecognition.requestPermissions();
    return st?.speechRecognition === 'granted';
  } catch (e) {
    console.warn('Запрос разрешения не удался:', e);
    return false;
  }
}

// ------------------------------------------------------------- нативный ---

async function startNative({ lang, onInterim, onEnd, onError, onStart }) {
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

    const avail = await SpeechRecognition.available();
    if (!avail?.available) {
      onError && onError('service-not-allowed');
      return { promise: Promise.resolve(''), stop: () => {}, abort: () => {} };
    }

    const st = await SpeechRecognition.checkPermissions();
    if (st?.speechRecognition !== 'granted') {
      const req = await SpeechRecognition.requestPermissions();
      if (req?.speechRecognition !== 'granted') {
        onError && onError('not-allowed');
        return { promise: Promise.resolve(''), stop: () => {}, abort: () => {} };
      }
    }

    let finalText = '';
    let settled = false;
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });

    // popup: false обязателен — при popup: true событие partialResults на Android не приходит.
    const partial = await SpeechRecognition.addListener('partialResults', (data) => {
      const t = data?.matches?.[0] ?? '';
      if (t) { finalText = t; onInterim && onInterim(t); }
    });
    const state = await SpeechRecognition.addListener('listeningState', (data) => {
      if (data?.status === 'started') { onStart && onStart(); return; }
      if (data?.status === 'stopped') {
        onEnd && onEnd();
        if (!settled) { settled = true; resolveFn(finalText.trim()); }
      }
    });

    const cleanup = async () => {
      try { await partial?.remove(); } catch (_) {}
      try { await state?.remove(); } catch (_) {}
    };

    await SpeechRecognition.start({
      language: lang || 'ru-RU',
      maxResults: 1,
      partialResults: true,
      popup: false,
    });

    return {
      promise,
      stop: async () => {
        try { await SpeechRecognition.stop(); } catch (_) {}
        await cleanup();
        if (!settled) { settled = true; resolveFn(finalText.trim()); }
      },
      abort: async () => {
        try { await SpeechRecognition.stop(); } catch (_) {}
        await cleanup();
        if (!settled) { settled = true; resolveFn(''); }
      },
    };
  } catch (e) {
    console.warn('Нативное распознавание недоступно:', e);
    onError && onError('service-not-allowed');
    return { promise: Promise.resolve(''), stop: () => {}, abort: () => {} };
  }
}

// ------------------------------------------------------------- браузерная ---

function startWeb({ lang, onInterim, onEnd, onError, onStart }) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return { promise: Promise.reject(new Error('unsupported')), stop: () => {}, abort: () => {} };
  }
  const rec = new Ctor();
  rec.lang = lang || 'ru-RU';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    rec.onstart = () => onStart && onStart();
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (onInterim) onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => {
      if (!settled) {
        settled = true;
        onError && onError(e.error);
        reject(new Error(e.error || 'speech-error'));
      }
    };
    rec.onend = () => {
      if (onEnd) onEnd();
      if (!settled) {
        settled = true;
        resolve(finalText.trim());
      }
    };
    try {
      rec.start();
    } catch (err) {
      settled = true;
      reject(err);
    }
  });

  return {
    promise,
    stop: () => { try { rec.stop(); } catch (_) {} },
    abort: () => { try { rec.abort(); } catch (_) {} },
  };
}

// ---------------------------------------------------------------------------- 

/**
 * Запускает одноразовое распознавание. Возвращает Promise<string>.
 * onInterim(text) — промежуточные результаты для живой расшифровки на экране.
 */
export function startRecognition(opts = {}) {
  return isNative() ? startNative(opts) : startWeb(opts);
}
