// lib/ai.js — слой распознавания речи.
// Основной путь: Web Speech API (SpeechRecognition) с языком ru-RU —
// распознавание происходит в облаке Google/Apple, т.е. фактически ИИ-распознавание.
// Если браузер не поддерживает SpeechRecognition (Firefox и др.), предлагаем
// ввести текст вручную или использовать демо-режим с заготовленными фразами.

export function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  return !!getRecognitionCtor();
}

/**
 * Запускает одноразовое распознавание. Возвращает Promise<string>.
 * onInterim(text) — промежуточные результаты для живой расшифровки на экране.
 */
export function startRecognition({ lang = 'ru-RU', onInterim, onEnd, onError, onStart } = {}) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return { promise: Promise.reject(new Error('unsupported')), stop: () => {} };
  }
  const rec = new Ctor();
  rec.lang = lang;
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
