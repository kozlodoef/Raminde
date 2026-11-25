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
 * Распознавание дат из речи.
 *
 * Раньше это была возможность платной версии: голосом задавались только время
 * и событие, а даты человек отмечал на календаре. На практике вышло хуже:
 * «двадцать пятого декабря» уходило в текст, и напоминание срабатывало
 * сегодня. Дата из речи — обычное ожидание, а не роскошь, поэтому сейчас она
 * доступна всем. Функция оставлена, чтобы вызовы не менялись, если ограничение
 * понадобится вернуть.
 */
export function dateSpeechEnabled() {
  return true;
}

/** Сколько дат можно отметить на одно событие. Сейчас без ограничений. */
export const MAX_DATES_PER_EVENT = null;
/** Сколько напоминаний можно создать на один день в бесплатной версии. */
export const FREE_REMINDERS_PER_DAY = 3;

/**
 * Единственное ограничение бесплатной версии — три напоминания в день.
 *
 * Всё остальное доступно без подписки: даты словами («завтра», «двадцать
 * пятого декабря»), несколько дат на событие, любое число напоминаний в
 * другие дни. Подписка снимает только дневной лимит.
 */
export function isPro(bill) {
  return !!bill?.premium;
}

/**
 * Сообщение о возможности платной версии.
 *
 * Показываем именно его, а не сухое «нельзя»: человек должен понимать, что
 * ограничение не поломка, и что за ним стоит.
 */
export const PRO_HINT = "Это доступно в ПРО-версии.";
