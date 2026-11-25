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
/**
 * Занятые места на каждом дне месяца.
 *
 * Место занимает и запланированное напоминание, и уже прозвучавшее. Второе
 * важно отдельно: прозвучавшее можно удалить, но день от этого не
 * освобождается. Иначе предел в три напоминания обходится в два нажатия —
 * поставить, дождаться, удалить — и смысла в нём нет.
 *
 * Считаем по идентификатору срабатывания: у запланированного и у прозвучавшего
 * одного и того же напоминания он совпадает, поэтому одно место не посчитается
 * дважды.
 */
function slotsOf(rules, month, fired) {
  const slots = new Map();
  const take = (date, id) => {
    if (!slots.has(date)) slots.set(date, new Set());
    slots.get(date).add(id);
  };
  for (const e of occurrencesInMonth(rules, month)) take(e.date, e.id);
  for (const date of Object.keys(fired || {}))
    if (date.startsWith(month) && Array.isArray(fired[date]))
      for (const id of fired[date]) take(date, id);
  const counts = new Map();
  for (const [date, ids] of slots) counts.set(date, ids.size);
  return counts;
}
// Exact for all chosen dates/one-off reminders. Recurrences are checked for the upcoming year
// plus any explicit dates present in the saved schedules, including dates further in the future.
export function assertDailyCapacity(
  existing,
  candidates,
  { fired = {}, now = Date.now(), maxPerDay = MAX_DAILY_EVENTS } = {},
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
  // Отдельное сообщение для случая, когда день закрыт прозвучавшими
  // напоминаниями. Человек их уже удалил и ждёт, что день освободился —
  // без объяснения он решит, что приложение сломалось.
  const spokenMessage = (date, count) => {
    const when = date.split("-").reverse().join(".");
    if (limit < MAX_DAILY_EVENTS)
      return `На ${when} уже прозвучало ${count} напоминания — это предел подписки. Удаление их день не освобождает: оформите её, чтобы ставить больше.`;
    return `На ${when} уже прозвучало ${count} напоминаний. Максимум — ${MAX_DAILY_EVENTS} в день.`;
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
    const before = slotsOf(existing, month, fired);
    const after = slotsOf(rules, month, fired);
    for (const [date, count] of after)
      // Отклоняем только когда день переполняется и его стало больше.
      // Уже сохранённые напоминания сверх предела продолжают работать:
      // ограничение касается создания, а не того, что человек успел завести.
      if (count > limit && count > (before.get(date) || 0)) {
        // Если день закрыт именно прозвучавшими — говорим об этом прямо,
        // иначе человек ищет виноватое напоминание, которого уже нет.
        const spoken = (fired?.[date] || []).length;
        throw Error(
          spoken >= limit ? spokenMessage(date, spoken) : limitMessage(date, count),
        );
      }
  }
}
