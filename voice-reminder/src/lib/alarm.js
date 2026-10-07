// lib/alarm.js — планирование напоминаний в системном будильнике.
//
// Зачем отдельный модуль. В браузере напоминание живёт в setTimeout внутри
// вкладки: закрыли вкладку — напоминание пропало. На Android так нельзя, нужен
// системный AlarmManager, который разбудит устройство и покажет уведомление,
// даже если приложение выгружено из памяти.
//
// Поэтому здесь два пути:
//   • native (Capacitor + @capacitor/local-notifications) → системный будильник;
//   • web → таймер браузера, как раньше (scheduler.js).
//
// Канал уведомлений создаётся лениво и только для нативной среды: у плагина
// createChannel с одним и тем же id заменяет канал, поэтому повторный вызов
// безопасен, но в вебе его просто нет.
import { isNative, toTime } from './native.js';
import { planTimer, dueReminders, MAX_TIMEOUT } from './scheduler.js';

export { planTimer, dueReminders, MAX_TIMEOUT };

// Android ограничивает формат идентификатора канала: латиница, цифры, подчёркивания.
const CHANNEL_ID = 'voice_reminder_alarms';
const CHANNEL_NAME = 'Напоминания';
const CHANNEL_DESC = 'Голосовые напоминания';
const CHANNEL_SOUND = 'default';

let channelReady = null;

async function getLocalNotifications() {
  if (!isNative()) return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications;
  } catch (e) {
    console.warn('Локальные уведомления недоступны:', e);
    return null;
  }
}

/** Создаёт канал уведомлений с высоким приоритетом (иначе звука не будет). */
async function ensureChannel(LN) {
  if (channelReady) return channelReady;
  channelReady = (async () => {
    try {
      await LN.createChannel({
        id: CHANNEL_ID,
        name: CHANNEL_NAME,
        description: CHANNEL_DESC,
        importance: 5,        // IMPORTANCE_HIGH — всплывающее уведомление со звуком
        visibility: 1,        // видно на экране блокировки
        sound: CHANNEL_SOUND,
        vibration: true,
      });
    } catch (e) {
      // Канал мог уже существовать — это не ошибка.
      console.warn('Канал уведомлений не создан:', e);
    }
  })();
  return channelReady;
}

/** Запрос разрешения на уведомления. На Android 13+ без него уведомлений не будет. */
export async function requestNotificationPermission() {
  const LN = await getLocalNotifications();
  if (!LN) return 'unsupported';
  try {
    const st = await LN.checkPermissions();
    if (st?.display === 'granted') return 'granted';
    const req = await LN.requestPermissions();
    return req?.display || 'denied';
  } catch (e) {
    console.warn('Разрешение на уведомления не получено:', e);
    return 'denied';
  }
}

/**
 * Ставит напоминание в системный будильник.
 * @returns {Promise<{scheduled:boolean, reason?:string}>}
 */
export async function scheduleAlarm(reminder) {
  const at = toTime(reminder?.when);
  if (at === null) return { scheduled: false, reason: 'invalid' };
  if (at <= Date.now()) return { scheduled: false, reason: 'past' };

  const LN = await getLocalNotifications();
  if (!LN) return { scheduled: false, reason: 'web' };

  try {
    await ensureChannel(LN);
    await LN.schedule({
      notifications: [{
        id: idFromReminder(reminder),
        title: '⏰ Напоминание',
        body: reminder.text || 'Напоминание',
        channelId: CHANNEL_ID,
        schedule: { at: new Date(at), allowWhileIdle: true },
        smallIcon: 'ic_stat_icon_config_sample',
        sound: CHANNEL_SOUND,
      }],
    });
    return { scheduled: true };
  } catch (e) {
    console.warn('Напоминание не поставлено в будильник:', e);
    return { scheduled: false, reason: String(e?.message || e) };
  }
}

/** Снимает напоминание из будильника. */
export async function cancelAlarm(reminder) {
  const LN = await getLocalNotifications();
  if (!LN) return;
  try {
    await LN.cancel({ notifications: [{ id: idFromReminder(reminder) }] });
  } catch (e) {
    console.warn('Напоминание не снято с будильника:', e);
  }
}

/** Снимает все запланированные напоминания приложения. */
export async function cancelAllAlarms() {
  const LN = await getLocalNotifications();
  if (!LN) return;
  try {
    const pending = await LN.getPending();
    if (pending?.notifications?.length) {
      await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch (e) {
    console.warn('Не удалось снять все напоминания:', e);
  }
}

/**
 * Идентификатор уведомления: у плагина это 32-битное целое, а у нас строковый id.
 * Считаем устойчивый хеш строки, чтобы один и тот же id давал одно и то же число
 * (иначе снять напоминание не получится).
 */
function idFromReminder(reminder) {
  const src = String(reminder?.id ?? reminder?.when ?? '');
  let h = 0;
  for (let i = 0; i < src.length; i++) {
    h = (h * 31 + src.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2147483647;
}
