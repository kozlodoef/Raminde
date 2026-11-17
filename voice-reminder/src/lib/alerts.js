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

/** Короткий шелест для анимации удаления карточки. */
export function playSwish() {
  try {
    const c = ctx();
    const duration = 0.28;
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * duration), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * 0.35;
    }
    const source = c.createBufferSource();
    source.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, c.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    source.connect(filter).connect(gain).connect(c.destination);
    source.start();
  } catch (error) {
    console.warn("Не удалось воспроизвести звук удаления:", error);
  }
}

/** Привлекающий внимание прерывистый сигнал "би-буп" по кругу, пока не остановят. */
export function playAlarm(loop = true, variant = "soft") {
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
      const patterns = {
        soft: [[660, 0, 0.16], [880, 0.28, 0.22]],
        bright: [[880, 0, 0.14], [1100, 0.2, 0.14], [1320, 0.4, 0.22]],
        pulse: [[520, 0, 0.22], [520, 0.34, 0.22], [520, 0.68, 0.22]],
      };
      for (const [frequency, offset, duration] of patterns[variant] || patterns.soft)
        beep(frequency, t + offset, duration);
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
export function speak(text, { rate = 0.95, pitch = 1, onend, lang = 'ru-RU' } = {}) {
  if (!('speechSynthesis' in window)) { onend && onend(); return false; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    u.pitch = pitch;
    const prefix = lang.toLowerCase().startsWith('en') ? 'en' : 'ru';
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(prefix));
    if (voice) u.voice = voice;
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
