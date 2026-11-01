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
// Freemium: бесплатная версия работает всегда, но с ограничением числа
// активных напоминаний. PRO снимает лимиты.
export const FREE_REMINDER_LIMIT = 3;
export const FREE_REPEAT_LIMIT = 1;
export function proActive(access, now = Date.now()) {
  return (access?.paidUntil || 0) > now;
}
export function canCreateFree(count, pro) {
  return pro || count < FREE_REMINDER_LIMIT;
}
