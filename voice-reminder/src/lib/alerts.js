// lib/alerts.js — звуковой сигнал, голосовое напоминание (TTS) и push-уведомления.

let audioCtx = null;
let alarmNodes = null;

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Привлекающий внимание прерывистый сигнал "би-буп" по кругу, пока не остановят. */
export function playAlarm(loop = true) {
  try {
    stopAlarm();
    const c = ctx();
    const master = c.createGain();
    master.gain.value = 0.28;
    master.connect(c.destination);

    const beep = (freq, at, dur) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(1, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(master);
      o.start(at); o.stop(at + dur + 0.05);
    };

    let timer = null;
    const cycle = () => {
      const t = c.currentTime;
      beep(880, t, 0.18);
      beep(660, t + 0.25, 0.18);
      beep(880, t + 0.5, 0.18);
      beep(1100, t + 0.8, 0.3);
      if (loop) timer = setTimeout(cycle, 1400);
    };
    cycle();
    alarmNodes = { master, timer, ctx: c };
  } catch (e) {
    console.warn('Не удалось воспроизвести звук:', e);
  }
}

export function stopAlarm() {
  if (alarmNodes) {
    clearTimeout(alarmNodes.timer);
    try { alarmNodes.master.disconnect(); } catch (_) {}
    alarmNodes = null;
  }
}

/** Голосовое озвучивание текста (ru, если доступен). */
export function speak(text, { rate = 0.95, pitch = 1, onend } = {}) {
  if (!('speechSynthesis' in window)) { onend && onend(); return false; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    u.rate = rate;
    u.pitch = pitch;
    const ruVoice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('ru'));
    if (ruVoice) u.voice = ruVoice;
    u.onend = () => onend && onend();
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.warn('TTS недоступен:', e);
    onend && onend();
    return false;
  }
}

export function cancelSpeech() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
}

export function ttsAvailable() {
  return 'speechSynthesis' in window;
}

/** Push-уведомления */
export function pushSupported() {
  return 'Notification' in window;
}

export async function requestPushPermission() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
}

export function sendPush(title, body) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, {
      body,
      icon: '/bell.svg',
      badge: '/bell.svg',
      tag: 'voice-reminder-' + Date.now(),
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (e) {
    console.warn('Push не отправлен:', e);
    return false;
  }
}

/** Разбудить аудио-контекст после первого жеста пользователя (требование браузеров). */
export function primeAudio() {
  document.addEventListener('pointerdown', once, { once: true });
  document.addEventListener('keydown', once, { once: true });
  function once() {
    try { ctx(); } catch (_) {}
    // прогреваем TTS списком голосов
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }
}
