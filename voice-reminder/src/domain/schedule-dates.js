// domain/schedule-dates.js — на какие дни и сколько раз рассчитано напоминание.
//
// Нужно, чтобы отличить «одно событие» от «серии»: удаляя карточку одного
// дня, человек должен знать, исчезнет ли только этот день или вся серия.
//
// Важно различать две разные вещи, которые раньше смешивались:
//  - несколько ДАТ: «24 и 26 ноября»;
//  - несколько ВРЕМЁН в один день: «24 ноября в 9:00 и в 12:00».
// Раньше количество считалось как даты × времена и любое число больше
// одного подписывалось «запланировано на несколько дат». Для одного дня с
// двумя временами это было неправдой.

import { localDate } from "./calendar.js";

/** Даты, на которые расписано правило. */
export function ruleDates(rule) {
  const s = rule?.schedule;
  if (!s) return [];
  if (s.kind === "dates") return [...new Set(s.dates || [])].sort();
  if (s.kind === "once") return s.at ? [localDate(new Date(s.at))] : [];
  return [];
}

/** Времена, на которые расписано правило. */
export function ruleTimes(rule) {
  const s = rule?.schedule;
  if (!s) return [];
  if (s.kind === "dates") return [...new Set(s.times || [])].sort();
  if (s.kind === "once") return s.at ? [localDate(new Date(s.at))] : [];
  return [];
}

/** Стоит ли правило больше чем на один день. */
export function spansSeveralDays(rule) {
  return ruleDates(rule).length > 1;
}

/**
 * Что именно предстоит изменить или удалить.
 *
 * Возвращает разбор, по которому строятся и решение «спрашивать ли», и сама
 * подпись. Вопрос «только этот день или все» имеет смысл, только когда дат
 * несколько. Одна дата с двумя временами — это два события в один день:
 * удаляя карточку одного времени, про остальные время того же дня не
 * спрашивают, их и так видно рядом.
 */
export function occurrenceScope(rule) {
  const s = rule?.schedule;
  if (!s)
    return {
      days: 0,
      times: 0,
      total: 0,
      recurring: false,
      multiDay: false,
      multiTime: false,
      ask: false,
    };
  const days = ruleDates(rule).length;
  const times = Math.max(1, (s.times || []).length);
  // Повторы (ежедневно, по будням) не имеют конечного списка: спрашивать
  // «только этот день или все» бессмысленно.
  const recurring = !["dates", "once"].includes(s.kind);
  return {
    days,
    times,
    total: recurring ? 0 : Math.max(days, 1) * times,
    recurring,
    multiDay: days > 1,
    multiTime: times > 1,
    // Спрашиваем только при нескольких датах.
    ask: !recurring && days > 1,
  };
}

/**
 * Подпись к выбору «только это или все».
 *
 * Окно показывается только при нескольких датах, поэтому текст строится
 * именно вокруг них.
 */
export function scopeWording(rule) {
  const { days, times, multiDay, multiTime } = occurrenceScope(rule);
  if (multiDay && multiTime)
    return `запланировано на ${days} даты, по ${times} раза в день`;
  if (multiDay) return `запланировано на несколько дат (${days})`;
  return "запланировано один раз";
}

/** Сколько всего срабатываний даёт правило. */
export function ruleOccurrenceCount(rule) {
  return occurrenceScope(rule).total;
}
