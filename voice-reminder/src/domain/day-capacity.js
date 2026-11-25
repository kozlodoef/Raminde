import { localDate } from "./calendar.js";
import { occurrencesInMonth } from "./groups.js";
import { FREE_REMINDERS_PER_DAY, MAX_REMINDERS_PER_DAY } from "./access.js";
/**
 * Максимум напоминаний на один день.
 *
 * Это техническая граница: в сутках 24 часа, и больше 24 отдельных
 * напоминаний на один день поставить нельзя. Раньше здесь стояло 12, и это
 * упиралось в обычный плотный день. Без подписки действует более низкий
 * предел из access.js — он передаётся сюда через maxPerDay.
 */
export const MAX_DAILY_EVENTS = MAX_REMINDERS_PER_DAY;
// Equal segments represent occurrences; a group with three times uses three segments of its colour.
export function daySegments(
  occurrences,
  date,
  { dates = [], color, draftId } = {},
) {
  const unique = new Map();
  for (const e of occurrences)
    if (e.date === date)
      unique.set(e.id, { ...e, pending: e.reminderId === draftId });
  const list = [...unique.values()].sort(
    (a, b) =>
      Number(a.pending) - Number(b.pending) ||
      a.at - b.at ||
      String(a.id).localeCompare(String(b.id)),
  );
  if (dates.includes(date) && !list.some((e) => e.reminderId === draftId))
    list.push({
      id: "draft@" + date,
      reminderId: draftId,
      color,
      pending: true,
    });
  return list;
}
function monthOf(t) {
  return localDate(new Date(t)).slice(0, 7);
}
// Exact for all chosen dates/one-off reminders. Recurrences are checked for the upcoming year
// plus any explicit dates present in the saved schedules, including dates further in the future.
export function assertDailyCapacity(
  existing,
  candidates,
  { events = [], now = Date.now(), maxPerDay = MAX_DAILY_EVENTS } = {},
) {
  const enabled = candidates.filter((r) => r.enabled !== false);
  if (!enabled.length) return;
  // Предел на день. Без подписки он ниже — три напоминания. Сообщение в этом
  // случае другое: человеку важно понять, что дело в подписке, а не в том,
  // что он что-то сделал неправильно.
  const limit = Number.isFinite(maxPerDay) ? maxPerDay : MAX_DAILY_EVENTS;
  // Подсказка упоминает подписку только когда дело действительно в ней:
  // при техническом пределе в 24 напоминания человеку нечего покупать.
  // Правило «в сообщении нет упоминания версии» проверяется тестом.
  const limitMessage = (date, count) => {
    const when = date.split("-").reverse().join(".");
    if (limit < MAX_DAILY_EVENTS)
      return `На ${when} уже ${count} напоминаний в день. Это предел подписки — оформите её, чтобы снять ограничение.`;
    return `На ${when} получится ${count} напоминаний. Максимум — ${MAX_DAILY_EVENTS} в день. Выберите другую дату или уберите лишнее время.`;
  };
  const months = new Set();
  let recurring = false;
  for (const r of enabled) {
    const s = r.schedule;
    if (s.kind === "dates") for (const d of s.dates) months.add(d.slice(0, 7));
    else if (s.kind === "once") months.add(monthOf(s.at));
    else recurring = true;
  }
  if (recurring) {
    const date = new Date(now);
    for (let i = 0; i <= 12; i++)
      months.add(
        localDate(
          new Date(date.getFullYear(), date.getMonth() + i, 1, 12),
        ).slice(0, 7),
      );
    for (const r of existing) {
      if (r.schedule.kind === "dates")
        for (const d of r.schedule.dates) months.add(d.slice(0, 7));
      if (r.schedule.kind === "once") months.add(monthOf(r.schedule.at));
    }
  }
  const ids = new Set(candidates.map((r) => r.id));
  const rules = [...existing.filter((r) => !ids.has(r.id)), ...candidates];
  for (const month of [...months].sort()) {
    // Сколько уже стоит на каждом дне. Отличаем «добавляю» от «правлю»:
    // правка правила на месте не увеличивает день, и предел ей мешать не
    // должен, иначе человек не смог бы поправить текст третьего напоминания.
    const before = new Map();
    for (const e of occurrencesInMonth(existing, month))
      before.set(e.date, (before.get(e.date) || 0) + 1);
    const after = new Map();
    for (const e of occurrencesInMonth(rules, month))
      after.set(e.date, (after.get(e.date) || 0) + 1);
    // Срабатывания, которые уже сработали, тоже занимают место на дне.
    for (const e of events) {
      const date = localDate(new Date(e.scheduledAt));
      if (date.startsWith(month))
        after.set(date, (after.get(date) || 0) + 1);
    }
    for (const [date, count] of after)
      // Отклоняем только когда день переполняется и его стало больше.
      // Уже сохранённые напоминания сверх предела продолжают работать:
      // ограничение касается создания, а не того, что человек успел завести.
      if (count > limit && count > (before.get(date) || 0))
        throw Error(limitMessage(date, count));
  }
}
