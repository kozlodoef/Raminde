import { localDate } from "./calendar.js";
import { occurrencesInMonth } from "./groups.js";
export const MAX_DAILY_EVENTS = 24;
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
  { events = [], now = Date.now() } = {},
) {
  const enabled = candidates.filter((r) => r.enabled !== false);
  if (!enabled.length) return;
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
    const affected = new Set(
      occurrencesInMonth(enabled, month).map((e) => e.date),
    );
    const all = new Map(occurrencesInMonth(rules, month).map((e) => [e.id, e]));
    for (const e of events) {
      const date = localDate(new Date(e.scheduledAt));
      if (date.startsWith(month)) all.set(e.id, { date });
    }
    const counts = new Map();
    for (const e of all.values())
      if (affected.has(e.date))
        counts.set(e.date, (counts.get(e.date) || 0) + 1);
    for (const [date, count] of counts)
      if (count > MAX_DAILY_EVENTS)
        throw Error(
          `На ${date.split("-").reverse().join(".")} получится ${count} событий. Максимум — 24 в день. Выберите другую дату или уберите лишнее время.`,
        );
  }
}
