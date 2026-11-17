// lib/alerts.js — звуковой сигнал, голосовое напоминание (TTS) и push-уведомления.

let audioCtx = null;
let alarmNodes = null;

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
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
      o.type = "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(1, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g);
      g.connect(master);
      o.start(at);
      o.stop(at + dur + 0.05);
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
    console.warn("Не удалось воспроизвести звук:", e);
  }
}

export function stopAlarm() {
  if (alarmNodes) {
    clearTimeout(alarmNodes.timer);
    try {
      alarmNodes.master.disconnect();
    } catch (_) {}
    alarmNodes = null;
  }
}

// Озвучка вынесена в lib/tts.js: у Web Speech API несколько дефектов
// (пустой список голосов при старте, обрыв на длинном тексте, тишина после
// cancel), которые нужно обходить явно. Ниже — реэкспорт для прежних
// импортов из alerts.js и локальный импорт, нужный функции primeAudio.
import { primeTts } from "./tts.js";
export { speak, cancelSpeech, ttsAvailable, primeTts } from "./tts.js";

/** Push-уведомления */
export function pushSupported() {
  return "Notification" in window;
}

export async function requestPushPermission() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
}

export function sendPush(title, body) {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(title, {
      body,
      icon: "/bell.svg",
      badge: "/bell.svg",
      tag: "voice-reminder-" + Date.now(),
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch (e) {
    console.warn("Push не отправлен:", e);
    return false;
  }
}

/** Разбудить аудио-контекст после первого жеста пользователя (требование браузеров). */
export function primeAudio() {
  document.addEventListener("pointerdown", once, { once: true });
  document.addEventListener("keydown", once, { once: true });
  function once() {
    try {
      ctx();
    } catch (_) {}
    // Прогрев TTS. Браузеры грузят список голосов асинхронно: без прогрева
    // первый speak() может не найти русский голос и озвучить чужим.
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      primeTts();
    }
  }
}

/** Short cue before recording; native Android uses ToneGenerator before SpeechRecognizer. */
export async function playRecordingCue() {
  try {
    const c = ctx();
    if (c.state !== "running") return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.09, c.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.1);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.11);
    await new Promise((resolve) => setTimeout(resolve, 130));
    g.disconnect();
  } catch (_) {
    /* Muted/blocked browser audio must not prevent recording. */
  }
}

/** Separate confirmation cue for the Done button. */
export async function playDictationDoneCue() {
  try {
    const c = ctx();
    if (c.state !== "running") return;
    const master = c.createGain();
    master.gain.value = 0.12;
    master.connect(c.destination);
    const tone = (frequency, at, duration) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.value = frequency;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(1, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      o.connect(g);
      g.connect(master);
      o.start(at);
      o.stop(at + duration + 0.03);
    };
    const t = c.currentTime;
    tone(660, t, 0.12);
    tone(440, t + 0.14, 0.18);
    await new Promise((resolve) => setTimeout(resolve, 360));
    master.disconnect();
  } catch (_) {}
}
