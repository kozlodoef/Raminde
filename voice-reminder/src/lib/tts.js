// lib/tts.js — голосовое озвучивание напоминаний в браузере.
//
// Почему отдельный модуль, а не три строки в alerts.js. У Web Speech API есть
// несколько известных дефектов, из-за которых простое «speak() и забыли»
// работает через раз:
//
//  1. getVoices() при первом вызове возвращает ПУСТОЙ список: браузер грузит
//     голоса асинхронно. Раньше из-за этого русский голос не выбирался.
//     Решение — ждать события voiceschanged.
//
//  2. В Chrome длинный текст обрывается примерно на 15 секундах. Причина —
//     внутренний таймаут: синтез «зависает» и приходит onerror. Решение —
//     ставить паузу-возобновление и аварийный таймер.
//
//  3. speak() после cancel() иногда молча ничего не делает: Chrome не
//     успевает сбросить состояние. Решение — короткая задержка перед стартом.
//
//  4. Без пользовательского жеста браузер может заблокировать звук целиком.
//     Поэтому есть primeTts(): «прогрев» на первом клике.
//
// На Android этот модуль не используется: там озвучка идёт через нативный
// TextToSpeech в DeliveryService.
import { isNative } from './native.js';

const LANG = 'ru-RU';

let voicesPromise = null;
let currentUtterance = null;
let watchdog = null;
let keepAlive = null;

/** Голоса загружаются асинхронно — ждём их один раз и запоминаем. */
function loadVoices() {
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    // В части браузеров событие приходит не всегда — страхуемся таймером.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, 1200);
  });
  return voicesPromise;
}

/** Русский голос, если он установлен в системе. */
async function pickRussianVoice() {
  const voices = await loadVoices();
  if (!voices?.length) return null;
  const lower = (v) => (v.lang || '').toLowerCase();
  // Сначала точное совпадение ru-RU, затем любой русский.
  return (
    voices.find((v) => lower(v) === 'ru-ru') ||
    voices.find((v) => lower(v).startsWith('ru')) ||
    null
  );
}

export function ttsAvailable() {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window;
}

/**
 * «Прогрев» синтезатора. Вызывать из обработчика клика: браузеры разрешают
 * звук только после действия пользователя.
 */
export function primeTts() {
  if (!ttsAvailable()) return;
  try {
    // Пустая фраза с нулевой громкостью разблокирует синтезатор в Chrome.
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  } catch (_) {}
}

/**
 * Озвучивает текст.
 * @returns {boolean} удалось ли запустить (false — синтеза нет вовсе)
 */
export function speak(text, { rate = 0.95, pitch = 1, onend } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) {
    onend && onend();
    return false;
  }
  // На Android озвучивает нативный слой — второй голос не нужен.
  if (isNative() || !ttsAvailable()) {
    onend && onend();
    return false;
  }

  try {
    const synth = window.speechSynthesis;
    // Останавливаем прошлую фразу и даём Chrome сбросить состояние.
    cancelSpeech();
    clearTimeout(watchdog);
    clearInterval(keepAlive);

    watchdog = setTimeout(() => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = LANG;
      u.rate = rate;
      u.pitch = pitch;
      u.onend = () => onend && onend();
      u.onerror = () => onend && onend();
      pickRussianVoice().then((voice) => {
        if (voice) u.voice = voice;
        try {
          synth.speak(u);
          currentUtterance = u;
        } catch (e) {
          console.warn('Озвучка не запустилась:', e);
          onend && onend();
        }
      });
      // Chrome останавливает синтез, если страница «спит»; пинг удерживает его.
      keepAlive = setInterval(() => {
        if (!synth.speaking) {
          clearInterval(keepAlive);
          return;
        }
        synth.pause();
        synth.resume();
      }, 10000);
    }, 60);

    return true;
  } catch (e) {
    console.warn('TTS недоступен:', e);
    onend && onend();
    return false;
  }
}

export function cancelSpeech() {
  clearTimeout(watchdog);
  clearInterval(keepAlive);
  watchdog = null;
  keepAlive = null;
  currentUtterance = null;
  if (!ttsAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {}
}
