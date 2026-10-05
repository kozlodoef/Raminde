// lib/storage.js — хранилище напоминаний и настроек (localStorage).

const R_KEY = 'vr.reminders';
const S_KEY = 'vr.settings';

export const DEFAULT_SETTINGS = {
  // 'voice' — после звукового сигнала озвучивать напоминание голосом;
  // 'push'  — после звукового сигнала присылать только push-уведомление.
  alertMode: 'voice',
  pushEnabled: true,
};

export function loadReminders() {
  try {
    const raw = localStorage.getItem(R_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return arr
      .filter((r) => r && r.id && r.when)
      .map((r) => ({ ...r, when: new Date(r.when) }));
  } catch (_) {
    return [];
  }
}

export function saveReminders(list) {
  try {
    localStorage.setItem(R_KEY, JSON.stringify(list));
  } catch (_) {}
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(S_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(S_KEY, JSON.stringify(s));
  } catch (_) {}
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
