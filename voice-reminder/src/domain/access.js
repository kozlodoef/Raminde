// A calendar month from first activation, never reset at the start of a month.
export function addMonth(timestamp) {
  const d = new Date(timestamp),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return d.getTime();
}
export function trialAccess(existing, now = Date.now()) {
  const start = Number.isFinite(existing?.trialStartedAt)
    ? existing.trialStartedAt
    : now;
  return { ...existing, trialStartedAt: start, trialEndsAt: addMonth(start) };
}
export function accessActive(access, now = Date.now()) {
  return (access?.trialEndsAt || 0) > now || (access?.paidUntil || 0) > now;
}
/**
 * Доступно ли распознавание дат из речи.
 *
 * Это возможность платной версии. В бесплатной версии голосом задаются
 * только время и событие, а даты человек отмечает на календаре; если не
 * отметил — напоминание встаёт на сегодня. Так проще и надёжнее: сказанную
 * дату легко расслышать неверно, а отмеченную на календаре — нет.
 *
 * Флаг приходит от платёжного сервера (поле premium). Если сервер не
 * настроен или подписки нет, распознавание дат выключено.
 */
export function dateSpeechEnabled(bill) {
  return !!bill?.premium;
}
