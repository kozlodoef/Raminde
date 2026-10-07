// lib/scheduler.js — когда ставить таймер для напоминания.
//
// Вынесено из App.jsx намеренно: внутри useEffect эта логика непроверяема,
// а у неё есть тонкости (лимит setTimeout, часовой пояс, смена суток,
// просроченные напоминания). Здесь это чистая функция, которую можно тестировать.
//
// Разбор момента времени живёт в native.js (toTime) и используется ещё в alarm.js,
// чтобы правило про new Date(null) было записано ровно в одном месте.
import { toTime } from './native.js';

/** Максимальная задержка setTimeout. Всё, что больше, срабатывает сразу. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Решение о планировании таймера.
 * @param when - момент срабатывания (Date | строка ISO | число)
 * @param now - текущее время (мс), по умолчанию Date.now()
 * @returns {{kind:'fire'|'wait'|'defer'|'invalid', delay:number}}
 *   fire    — уже наступило (или почти): ставим короткую задержку
 *   wait    — в пределах лимита setTimeout: ставим точную задержку
 *   defer   — дальше лимита: ставим «заглушку» и пересчитаем позже
 *   invalid — некорректная дата: таймер ставить не нужно
 */
export function planTimer(when, now = Date.now()) {
  const t = toTime(when);
  if (t === null) return { kind: 'invalid', delay: 0 };

  const delay = t - now;
  if (delay <= 0) return { kind: 'fire', delay: 0 };
  if (delay > MAX_TIMEOUT) return { kind: 'defer', delay: MAX_TIMEOUT };
  return { kind: 'wait', delay };
}

/**
 * Требуется ли пересчёт таймеров при возврате вкладки в активное состояние.
 * Браузеры сильно тормозят таймеры в фоновых вкладках, поэтому после возврата
 * нужно проверить, не наступило ли время, пока вкладка спала.
 * @returns {Array} напоминания, которые уже пора показать
 */
export function dueReminders(reminders, now = Date.now()) {
  return (reminders || []).filter((r) => {
    if (!r || r.done) return false;
    const t = toTime(r.when);
    return t !== null && t <= now;
  });
}
