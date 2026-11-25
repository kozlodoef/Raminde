import { assertDailyCapacity } from "./day-capacity.js";
import { trialAccess } from "./access.js";
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
  // Вид сигнала перед напоминанием: marimba, bell, harp, chime, beep, alarm.
  //
  // По умолчанию — маримба. Раньше стоял «будильник»: два резких тона
  // попеременно, и это первое, что слышал новый пользователь. Для
  // напоминания о деле такой звук слишком грубый — он годится, чтобы
  // разбудить, а не чтобы сказать «пора полить цветы». Громкие варианты
  // остались в списке: их выбирают осознанно.
  cue: "marimba",
  vibration: true,
  privateNotification: false,
  rate: 0.95,
  pickerSound: false,
  autoListen: false,
  // Тихие отклики на действия: удаление, изменение, переключение.
  // Отдельно от звука напоминаний: это не сигнал, а подтверждение нажатия.
  uiSounds: true,
};
const KEY = "raminde.v2";
/**
 * Режимы напоминания, которые сейчас есть в приложении.
 *
 * «Голосом и уведомлением» — озвучка плюс уведомление.
 * «Только уведомлением» — без озвучки.
 *
 * Режима «только голосом» больше нет.
 */
export const REMINDER_MODES = ["voiceAndNotification", "notification"];

/**
 * Приводит сохранённые настройки к нынешнему набору режимов.
 *
 * Режима «только голосом» больше нет в списке: без уведомления напоминание
 * легко пропустить. Но у тех, кто успел его выбрать, в настройках лежит
 * mode: "voice". Показывать им первый пункт списка и при этом работать
 * по-старому нельзя: человек видел бы «Голосом и уведомлением», а уведомление
 * не приходило бы. Поэтому значение переводится при чтении — один раз и без
 * участия человека.
 *
 * Неизвестное значение (мусор в хранилище, правка руками, чужая версия)
 * тоже приводится к первому режиму: иначе список в настройках показал бы
 * пустое поле, и человек не понял бы, что случилось.
 */
export function normalizeSettings(settings) {
  const next = { ...defaults, ...settings };
  if (!REMINDER_MODES.includes(next.mode)) next.mode = REMINDER_MODES[0];
  return next;
}
export function emptyState() {
  return {
    reminders: [],
    settings: { ...defaults },
    events: [],
    // Прозвучавшие напоминания по дням: { "2026-11-26": ["id@время", …] }.
    // Живут отдельно от events: events удаляются вместе с напоминанием, а
    // израсходованное место в дне бесплатной версии исчезать не должно.
    fired: {},
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
        settings: normalizeSettings(state.settings),
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
    return { ...result, settings: normalizeSettings(result.settings) };
  }
  return readWeb();
}
/**
 * Только срабатывания — для частой проверки, пока приложение открыто.
 *
 * Полное состояние для этого слишком дорого: оно несёт все правила и
 * настройки, которые меняются лишь действиями самого человека. Здесь нужен
 * один список событий, чтобы заметить звонящее напоминание.
 */
export async function liveEvents() {
  if (isNative()) return (await Native.events()).events || [];
  return fireWeb().events || [];
}
/**
 * Полное восстановление расписания нативным слоем.
 *
 * Отдельно от getState намеренно: состояние опрашивается каждые полторы
 * секунды, и раньше каждый такой опрос заново читал все правила, пересчитывал
 * расписание, писал в базу и переставлял будильники. Теперь восстановление
 * происходит только там, где оно действительно нужно — при возврате в
 * приложение и при открытии с уведомления.
 */
export async function restoreSchedule() {
  if (!isNative()) return null;
  try {
    return await Native.restore();
  } catch {
    // Восстановление — страховка, а не основной путь: если нативный слой
    // отказал, приложение всё равно должно открыться.
    return null;
  }
}
function saveWeb(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
export async function setSettings(settings) {
  if (isNative()) return Native.settings({ settings });
  const s = readWeb();
  s.settings = normalizeSettings(settings);
  return saveWeb(s);
}
export async function putReminder(
  reminder,
  { reservation = null, maxPerDay = null } = {},
) {
  if (isNative()) {
    const current = await Native.getState();
    assertDailyCapacity(current.reminders || [], [reminder], {
      fired: current.fired || {},
      ...(maxPerDay ? { maxPerDay } : {}),
    });
    return Native.upsert({ reminder, reservation });
  }
  const s = readWeb();
  assertDailyCapacity(s.reminders, [reminder], {
    fired: s.fired || {},
    ...(maxPerDay ? { maxPerDay } : {}),
  });
  const existing = s.reminders.find((r) => r.id === reminder.id);
  const month = localDate(new Date(), s.quota.timezone).slice(0, 7);
  if (month !== s.quota.month) s.quota = { ...s.quota, month, used: 0 };
  // Стены «пробный месяц закончился» здесь больше нет: напоминания
  // сохраняются всегда, а ограничивает их только дневной предел, который
  // проверяется выше. Так приложение не перестаёт работать на тридцать
  // первый день — раньше именно это и происходило.
  const next = nextOccurrences(reminder.schedule, Date.now(), 1)[0];
  // Прошедшее правило править можно.
  //
  // Раньше здесь требовалось будущее срабатывание, и напоминание, которое
  // уже сработало, нельзя было ни исправить, ни переименовать: оставалось
  // только удалить. Теперь достаточно, чтобы само правило было рабочим:
  // если у него нет будущих дат, оно просто не сработает, но текст и время
  // в нём уже можно поправить.
  if (reminder.enabled && !next && !existing)
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
    if (!s.events.some((e) => e.id === id)) {
      s.events.push({
        id,
        reminderId: r.id,
        text: r.text,
        state: "ringing",
        attemptCount: 1,
        scheduledAt: r.nextTriggerAt,
        deliveredAt: now,
      });
      // Отмечаем место в дне сразу при срабатывании. Метка живёт в отдельном
      // списке и переживает удаление напоминания: иначе предел обходится тем,
      // что прозвучавшее напоминание удаляют и ставят новое.
      const day = localDate(new Date(r.nextTriggerAt));
      s.fired = s.fired || {};
      if (!Array.isArray(s.fired[day])) s.fired[day] = [];
      if (!s.fired[day].includes(id)) s.fired[day].push(id);
    }
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
/**
 * Открывает системный экран «Полноэкранные уведомления».
 *
 * На Android 14+ без этого согласия напоминание не развернётся поверх
 * блокировки, и его легко пропустить. На более старых версиях разрешение
 * не требуется, поэтому функция сразу сообщает об успехе.
 */
export async function requestFullscreen() {
  if (isNative()) return Native.requestFullscreen();
  return { granted: true };
}
/**
 * Открывает системный запрос на отключение экономии батареи.
 *
 * На MIUI, EMUI и OneUI агрессивная экономия выгружает фон, и напоминание
 * может не прозвучать вовремя. Функция лишь открывает нужный экран:
 * окончательное решение остаётся за пользователем.
 */
export async function requestBattery() {
  if (isNative()) return Native.requestBattery();
  return { opened: true };
}
/**
 * Открывает экран автозапуска прошивки.
 *
 * На MIUI и EMUI без разрешённого автозапуска система не отдаёт приложению
 * трансляцию о загрузке и блокирует фоновые задания — тогда после
 * перезагрузки телефона напоминания не восстанавливаются. Экономия батареи
 * на это не влияет, нужен именно автозапуск.
 */
export async function requestAutostart() {
  if (isNative()) return Native.requestAutostart();
  return { opened: false, hint: "Автозапуск настраивается только на телефоне." };
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
  // Уже наступившее срабатывание исключить нельзя: оно либо ещё звучит, и
  // его надо подтвердить или отложить, либо прошло. Раньше здесь бросалась
  // ошибка, и удаление сработавшего напоминания молча не происходило —
  // карточка оставалась на месте. Разделяем случаи: «снять прошедшее» —
  // это dismissOccurrence, а не пропуск будущего.
  if (at <= Date.now()) return dismissOccurrence(id, at);
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
/**
 * Убирает уже наступившее срабатывание.
 *
 * Прошедшее или звучащее срабатывание нельзя «пропустить» — его можно только
 * снять: запись о нём удаляется, чтобы карточка не появлялась снова, а у
 * правила исключается этот момент. Так удаление сработавшего напоминания
 * действительно удаляет его.
 *
 * Правила может уже не быть — например, его удалили, а запись о показе
 * осталась. Тогда снимаем только саму запись: раньше такая карточка
 * оставалась на экране навсегда, и удалить её было нечем.
 *
 * Если у правила больше не остаётся будущих срабатываний, правило
 * отключается: иначе оно висело бы в списке без дат.
 */
export async function dismissOccurrence(id, at) {
  if (isNative()) return Native.dismiss({ id, at });
  const s = readWeb(),
    r = s.reminders.find((v) => v.id === id);
  s.events = s.events.filter(
    (e) => !(e.reminderId === id && (at === undefined || e.scheduledAt === at)),
  );
  if (r) {
    r.schedule = {
      ...r.schedule,
      excludedInstants: [
        ...new Set([...(r.schedule.excludedInstants || []), at]),
      ],
    };
    r.nextTriggerAt = r.enabled
      ? nextOccurrences(r.schedule, Date.now(), 1)[0] || null
      : null;
    if (!r.nextTriggerAt) r.enabled = false;
  }
  return saveWeb(s);
}
export async function skipNext(reminder) {
  if (!reminder.nextTriggerAt) throw Error("Нет ближайшего срабатывания");
  return skipOccurrence(reminder.id, reminder.nextTriggerAt);
}
