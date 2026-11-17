import {
  localDate,
  nextOccurrences,
  pad,
  parts,
  zone,
  zonedTime,
} from "./calendar.js";

export const EVENT_COLORS = [
  "#ff1744",
  "#00c853",
  "#2962ff",
  "#ffab00",
  "#d500f9",
  "#00b8d4",
  "#ff6d00",
];

export function nextReminderColor(existing = []) {
  const indexed = (existing || []).filter((reminder) =>
    Number.isInteger(reminder?.colorIndex),
  );
  if (!indexed.length) return 0;
  const newest = indexed.reduce((latest, reminder) =>
    (reminder.createdAt ?? 0) >= (latest.createdAt ?? 0) ? reminder : latest,
  );
  return (newest.colorIndex + 1) % EVENT_COLORS.length;
}

export function stableReminderColor(id = "", colorIndex = null) {
  if (Number.isInteger(colorIndex)) return EVENT_COLORS[((colorIndex % EVENT_COLORS.length) + EVENT_COLORS.length) % EVENT_COLORS.length];
  const hash = String(id).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return EVENT_COLORS[hash % EVENT_COLORS.length];
}

export function toggleDateSelection(dates = [], date) {
  const current = new Set(dates);
  if (current.has(date)) current.delete(date);
  else current.add(date);
  return [...current].sort();
}

export function shiftCalendarMonth(value, delta) {
  const [year, month] = String(value || localDate()).slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function scheduleForSelectedDates(schedule, dates = []) {
  if (!schedule || schedule.kind === "interval" || !dates.length) return schedule;
  const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
  const time = schedule.kind === "once" && schedule.at
    ? (() => {
        const p = parts(new Date(schedule.at), tz);
        return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
      })()
    : schedule.times?.[0];
  return {
    ...schedule,
    kind: "calendar",
    frequency: "daily",
    specificDates: [...dates],
    anchorDate: dates[0],
    times: time ? [time, ...(schedule.times || []).slice(1)] : schedule.times,
  };
}

export function shouldAutoStartRecording({ onboarded, screen, modal, attempted }) {
  return Boolean(onboarded && screen === "home" && !modal && !attempted);
}

export function recordingButtonLabel({ listening, hasText, language = "ru" }) {
  if (language === "en") return listening || hasText ? "Done" : "Start";
  return listening || hasText ? "Готово" : "Начать";
}

export function dateSelectionConflict(schedule, selectedDates = [], spokenDate = null) {
  if (!schedule || !selectedDates.length || schedule.kind === "interval") return false;
  if (spokenDate === false) return false;
  const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
  const spokenDates = schedule.specificDates?.length
    ? [...new Set(schedule.specificDates)].sort()
    : schedule.kind === "once" && schedule.at
      ? [localDate(new Date(schedule.at), tz)]
      : [];
  if (!spokenDates.length) return false;
  return spokenDates.join(",") !== [...new Set(selectedDates)].sort().join(",");
}

function occurrenceWindow(date, schedule) {
  const tz = schedule?.timezoneMode === "fixed" ? schedule.timezone : zone();
  const start = zonedTime(date, "00:00", tz) - 1;
  const end = zonedTime(date, "23:59", tz) + 60000;
  return { tz, start, end };
}

export function reminderTimesOnDate(reminder, date) {
  if (!reminder?.enabled || !reminder.schedule) return [];
  const { tz, start, end } = occurrenceWindow(date, reminder.schedule);
  if (reminder.schedule.kind === "once") {
    const when = new Date(reminder.schedule.at).getTime();
    return Number.isFinite(when) && when >= start && when <= end && localDate(new Date(when), tz) === date
      ? [when]
      : [];
  }
  return nextOccurrences(reminder.schedule, start, 128).filter(
    (when) => when <= end && localDate(new Date(when), tz) === date,
  );
}

function candidateDates(reminder) {
  const schedule = reminder?.schedule;
  if (!schedule) return [];
  if (schedule.specificDates?.length) return [...new Set(schedule.specificDates)];
  const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
  return [
    ...new Set(
      nextOccurrences(schedule, Date.now() - 1, 370).map((when) =>
        localDate(new Date(when), tz),
      ),
    ),
  ];
}

export function findCapacityConflicts(candidate, existing, limit = 12) {
  const conflicts = [];
  for (const date of candidateDates(candidate)) {
    const count = existing.reduce(
      (total, reminder) => total + (reminder.id === candidate.id ? 0 : reminderTimesOnDate(reminder, date).length),
      0,
    );
    const candidateCount = reminderTimesOnDate(candidate, date).length;
    if (count + candidateCount > limit) conflicts.push({ date, count, limit });
  }
  return conflicts;
}

export function findTimeConflicts(candidate, existing) {
  const conflicts = [];
  const timeZoneOf = (reminder) =>
    reminder.schedule?.timezoneMode === "fixed" ? reminder.schedule.timezone : zone();
  // Compare exact instants rounded to the minute: two reminders collide only if
  // they actually fire at the same moment, regardless of how each is displayed.
  const instantKey = (when) => Math.floor(when / 60000);
  for (const date of candidateDates(candidate)) {
    const candidateInstants = new Set(
      reminderTimesOnDate(candidate, date).map(instantKey),
    );
    if (!candidateInstants.size) continue;
    for (const reminder of existing) {
      if (reminder.id === candidate.id) continue;
      const tz = timeZoneOf(reminder);
      for (const when of reminderTimesOnDate(reminder, date)) {
        if (!candidateInstants.has(instantKey(when))) continue;
        const clock = parts(new Date(when), tz);
        conflicts.push({
          date,
          time: `${pad(clock.h)}:${pad(clock.min)}`,
          reminderId: reminder.id,
          text: reminder.text,
        });
      }
    }
  }
  return conflicts;
}
