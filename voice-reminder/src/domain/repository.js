import { trialAccess, accessActive } from "./access.js";
import { registerPlugin } from "@capacitor/core";
import { isNative } from "../lib/native.js";
import {
  defaultSchedule,
  localDate,
  nextOccurrences,
  zone,
} from "./calendar.js";
export const Native = registerPlugin("ReminderEngine");
export const defaults = {
  name: "",
  onboarded: false,
  theme: "system",
  mode: "voiceAndNotification",
  repeat: false,
  repeatMinutes: 5,
  maxAttempts: 12,
  voiceAck: false,
  screenAck: false,
  keywords: "хорошо,понял,поняла,слышу",
  sound: true,
  vibration: true,
  privateNotification: false,
  rate: 0.95,
  pickerSound: false,
  autoListen: true,
};
const KEY = "raminde.v2";
export function emptyState() {
  return {
    reminders: [],
    settings: { ...defaults },
    events: [],
    access: trialAccess(),
    quota: { month: localDate().slice(0, 7), used: 0, timezone: zone() },
    errors: [],
  };
}
function readWeb() {
  try {
    const state = JSON.parse(localStorage.getItem(KEY) || "null");
    if (state) {
      const merged = {
        ...emptyState(),
        ...state,
        access: trialAccess(state.access),
        settings: { ...defaults, ...state.settings },
      };
      localStorage.setItem(KEY, JSON.stringify(merged));
      return merged;
    }
    const old = JSON.parse(localStorage.getItem("vr.reminders") || "[]");
    const valid = old
      .filter(
        (r) => r?.id && !r.done && Number.isFinite(new Date(r.when).getTime()),
      )
      .map((r) => ({
        ...r,
        enabled: true,
        schedule: {
          ...defaultSchedule(),
          kind: "once",
          at: new Date(r.when).toISOString(),
        },
      }));
    const s = emptyState();
    s.reminders = valid;
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  } catch {
    return emptyState();
  }
}
export async function getState() {
  if (isNative()) {
    let result = await Native.getState();
    if (!localStorage.getItem("raminde.nativeMigrated")) {
      const old = readWeb();
      result = await Native.migrate({
        reminders: old.reminders,
        settings: old.settings,
      });
      localStorage.setItem("raminde.nativeMigrated", "yes");
    }
    return { ...result, settings: { ...defaults, ...result.settings } };
  }
  return readWeb();
}
function saveWeb(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
export async function setSettings(settings) {
  if (isNative()) return Native.settings({ settings });
  const s = readWeb();
  s.settings = { ...defaults, ...settings };
  return saveWeb(s);
}
export async function putReminder(reminder, { reservation = null } = {}) {
  if (isNative()) return Native.upsert({ reminder, reservation });
  const s = readWeb();
  const existing = s.reminders.find((r) => r.id === reminder.id);
  const month = localDate(new Date(), s.quota.timezone).slice(0, 7);
  if (month !== s.quota.month) s.quota = { ...s.quota, month, used: 0 };
  if (
    (!existing || reminder.enabled) &&
    !reservation &&
    !accessActive(s.access)
  )
    throw new Error("SUBSCRIPTION");
  const next = nextOccurrences(reminder.schedule, Date.now(), 1)[0];
  if (reminder.enabled && !next)
    throw new Error("Нет будущих дат для этого расписания");
  s.reminders = existing
    ? s.reminders.map((r) =>
        r.id === reminder.id ? { ...reminder, nextTriggerAt: next } : r,
      )
    : [...s.reminders, { ...reminder, nextTriggerAt: next }];
  if (!existing) s.quota.used++;
  return saveWeb(s);
}
export async function deleteReminder(id) {
  if (isNative()) return Native.remove({ id });
  const s = readWeb();
  s.reminders = s.reminders.filter((r) => r.id !== id);
  s.events = s.events.filter((e) => e.reminderId !== id);
  return saveWeb(s);
}
export async function acknowledge(id, source = "button") {
  if (isNative()) return Native.acknowledge({ id, source });
  const s = readWeb();
  s.events = s.events.map((e) =>
    e.id === id ? { ...e, state: "acknowledged", ackSource: source } : e,
  );
  const e = s.events.find((e) => e.id === id),
    r = s.reminders.find((r) => r.id === e?.reminderId);
  if (r?.schedule.kind === "once") r.enabled = false;
  return saveWeb(s);
}
export async function snooze(id, minutes = 5) {
  if (isNative()) return Native.snooze({ id, minutes });
  const s = readWeb();
  s.events = s.events.map((e) =>
    e.id === id
      ? { ...e, state: "snoozed", retryAt: Date.now() + minutes * 60000 }
      : e,
  );
  return saveWeb(s);
}
export async function fireWeb() {
  if (isNative()) return getState();
  const s = readWeb(),
    now = Date.now();
  for (const r of s.reminders) {
    if (!r.enabled || !r.nextTriggerAt || r.nextTriggerAt > now) continue;
    const id = r.id + "@" + r.nextTriggerAt;
    if (!s.events.some((e) => e.id === id))
      s.events.push({
        id,
        reminderId: r.id,
        text: r.text,
        state: "ringing",
        attemptCount: 1,
        scheduledAt: r.nextTriggerAt,
        deliveredAt: now,
      });
    r.nextTriggerAt = nextOccurrences(r.schedule, now, 1)[0] || null;
    if (!r.nextTriggerAt) r.enabled = false;
  }
  for (const e of s.events) {
    if (e.state === "snoozed" && e.retryAt <= now) {
      e.state = "ringing";
      e.attemptCount++;
    }
  }
  return saveWeb(s);
}
export async function permissions() {
  if (isNative()) return Native.permissions();
  return {
    notifications:
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    exact: false,
    platform: "web",
  };
}
export async function requestPermissions() {
  if (isNative()) return Native.requestPermissions();
  if (typeof Notification !== "undefined")
    await Notification.requestPermission();
  return permissions();
}
export async function speakName(text) {
  if (isNative()) return Native.speak({ text });
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ru-RU";
    speechSynthesis.speak(utterance);
  }
}

export async function skipOccurrence(id, at) {
  if (at <= Date.now())
    throw Error("Срабатывание уже началось: подтвердите или отложите его");
  if (isNative()) return Native.skip({ id, at });
  const s = readWeb(),
    r = s.reminders.find((v) => v.id === id);
  if (!r) throw Error("Напоминание не найдено");
  r.schedule = {
    ...r.schedule,
    excludedInstants: [...(r.schedule.excludedInstants || []), at],
  };
  r.nextTriggerAt = r.enabled
    ? nextOccurrences(r.schedule, Date.now(), 1)[0] || null
    : null;
  if (!r.nextTriggerAt) r.enabled = false;
  return saveWeb(s);
}
export async function skipNext(reminder) {
  if (!reminder.nextTriggerAt) throw Error("Нет ближайшего срабатывания");
  return skipOccurrence(reminder.id, reminder.nextTriggerAt);
}
