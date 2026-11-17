import { registerPlugin } from "@capacitor/core";
import { isNative } from "../lib/native.js";
import {
  defaultSchedule,
  localDate,
  nextOccurrences,
  zone,
} from "./calendar.js";
export const Native = registerPlugin("ReminderEngine");
import { EVENT_COLORS } from "./interaction.js";

/** Поддерживаются ровно два режима доставки. */
export const DELIVERY_NOTIFICATION = "notification";
export const DELIVERY_VOICE_AND_NOTIFICATION = "voiceAndNotification";
export const DEFAULT_DELIVERY_MODE = DELIVERY_VOICE_AND_NOTIFICATION;

/**
 * Сводит режим доставки к двум поддерживаемым вариантам.
 *
 * Исторически существовал отдельный режим "voice" (только голос, без
 * уведомления). Он отменён: без звукового уведомления пользователь может
 * пропустить событие. Старый "voice" превращается в "голос + уведомление",
 * то есть голос сохраняется и к нему добавляется уведомление со звуком.
 * Всё, что явно означает «только уведомление», остаётся таким.
 */
export function normalizeMode(mode) {
  if (mode === DELIVERY_NOTIFICATION || mode === "push" || mode === "onlyNotification")
    return DELIVERY_NOTIFICATION;
  return DELIVERY_VOICE_AND_NOTIFICATION;
}

export const defaults = {
  name: "",
  onboarded: false,
  language: "ru",
  theme: "system",
  mode: DEFAULT_DELIVERY_MODE,
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
  soundVariant: "soft",
  customSoundUri: "",
};
const KEY = "raminde.v2";

export function emptyState() {
  return {
    reminders: [],
    settings: { ...defaults },
    events: [],
    quota: { month: localDate().slice(0, 7), used: 0, timezone: zone() },
    errors: [],
  };
}
function readWeb() {
  try {
    const state = JSON.parse(localStorage.getItem(KEY) || "null");
    if (state)
      return {
        ...emptyState(),
        ...state,
        settings: { ...defaults, ...state.settings, mode: normalizeMode(state.settings?.mode) },
      };
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
    return s;
  } catch {
    return emptyState();
  }
}
function withColorIndexes(state) {
  const list = state.reminders || [];
  if (!list.length) return state;
  // Цвета идут по кругу в порядке создания: 1-й, 2-й, ... 7-й, снова 1-й.
  // Пересчёт чинит и старые записи, где цвет успел повториться.
  const ordered = [...list]
    .map((reminder, position) => ({ reminder, position }))
    .sort((a, b) => (a.reminder.createdAt ?? 0) - (b.reminder.createdAt ?? 0) || a.position - b.position);
  const assigned = new Map();
  ordered.forEach(({ reminder }, index) => {
    assigned.set(reminder, index % EVENT_COLORS.length);
  });
  const reminders = list.map((reminder) =>
    reminder.colorIndex === assigned.get(reminder)
      ? reminder
      : { ...reminder, colorIndex: assigned.get(reminder) },
  );
  return reminders.some((reminder, index) => reminder !== list[index])
    ? { ...state, reminders }
    : state;
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
    return { ...withColorIndexes(result), settings: { ...defaults, ...result.settings, mode: normalizeMode(result.settings?.mode) } };
  }
  return withColorIndexes(readWeb());
}
function saveWeb(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
export async function setSettings(settings) {
  if (isNative()) return Native.settings({ settings: { ...settings, mode: normalizeMode(settings.mode) } });
  const s = readWeb();
  s.settings = { ...defaults, ...settings, mode: normalizeMode(settings.mode) };
  return saveWeb(s);
}
export async function putReminder(reminder, { reservation = null, now = Date.now() } = {}) {
  if (isNative()) return Native.upsert({ reminder, reservation });
  const s = readWeb();
  const existing = s.reminders.find((r) => r.id === reminder.id);
  const month = localDate(new Date(now), s.quota.timezone).slice(0, 7);
  if (month !== s.quota.month) s.quota = { ...s.quota, month, used: 0 };
  const next = nextOccurrences(reminder.schedule, now, 1)[0];
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
export async function speakName(text, language = "ru") {
  if (isNative()) return Native.speak({ text, language });
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "en" ? "en-US" : "ru-RU";
    speechSynthesis.speak(utterance);
  }
}

export async function skipNext(reminder) {
  const next = reminder.nextTriggerAt;
  if (!next) throw new Error("Нет ближайшего срабатывания");
  return putReminder({
    ...reminder,
    schedule: {
      ...reminder.schedule,
      excludedInstants: [...(reminder.schedule.excludedInstants || []), next],
    },
  });
}

export async function excludeDate(reminder, date) {
  if (reminder.schedule.kind === "once" || reminder.schedule.kind === "interval")
    return deleteReminder(reminder.id);
  const schedule = {
    ...reminder.schedule,
    excludedDates: [...new Set([...(reminder.schedule.excludedDates || []), date])],
  };
  const candidate = { ...reminder, schedule };
  if (!nextOccurrences(schedule, Date.now(), 1).length)
    return deleteReminder(reminder.id);
  return putReminder(candidate);
}
