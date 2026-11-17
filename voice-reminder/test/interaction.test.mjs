import test from "node:test";
import assert from "node:assert/strict";
import { defaultSchedule } from "../src/domain/calendar.js";
import {
  findCapacityConflicts,
  dateSelectionConflict,
  findTimeConflicts,
  recordingButtonLabel,
  scheduleForSelectedDates,
  shiftCalendarMonth,
  shouldAutoStartRecording,
  stableReminderColor,
  toggleDateSelection,
} from "../src/domain/interaction.js";

const schedule = (date, time = "09:00") => ({
  ...defaultSchedule(new Date(`${date}T00:00:00Z`)),
  kind: "calendar",
  frequency: "daily",
  anchorDate: date,
  specificDates: [date],
  timezoneMode: "fixed",
  timezone: "UTC",
  times: [time],
});

test("date selection toggles without creating duplicate dates", () => {
  assert.deepEqual(toggleDateSelection(["2026-11-15"], "2026-11-20"), ["2026-11-15", "2026-11-20"]);
  assert.deepEqual(toggleDateSelection(["2026-11-15", "2026-11-20"], "2026-11-15"), ["2026-11-20"]);
});

test("calendar month navigation does not select the first day", () => {
  assert.equal(shiftCalendarMonth("2026-12-19", 1), "2027-01");
  assert.equal(shiftCalendarMonth("2027-01-19", -1), "2026-12");
});

test("calendar selection preserves a spoken once-reminder time", () => {
  const once = {
    ...defaultSchedule(new Date("2026-11-15T00:00:00Z")),
    kind: "once",
    at: "2026-11-15T04:15:00.000Z",
    timezoneMode: "fixed",
    timezone: "UTC",
  };
  const selected = scheduleForSelectedDates(once, ["2026-11-15", "2026-11-20"]);
  assert.equal(selected.kind, "calendar");
  assert.deepEqual(selected.specificDates, ["2026-11-15", "2026-11-20"]);
  assert.deepEqual(selected.times, ["04:15"]);
});

test("recording starts automatically once per normal home entry", () => {
  assert.equal(shouldAutoStartRecording({ onboarded: true, screen: "home", modal: null, attempted: false }), true);
  assert.equal(shouldAutoStartRecording({ onboarded: true, screen: "home", modal: null, attempted: true }), false);
  assert.equal(shouldAutoStartRecording({ onboarded: false, screen: "home", modal: null, attempted: false }), false);
  assert.equal(shouldAutoStartRecording({ onboarded: true, screen: "events", modal: null, attempted: false }), false);
  assert.equal(recordingButtonLabel({ listening: false, hasText: false }), "Начать");
  assert.equal(recordingButtonLabel({ listening: true, hasText: false }), "Готово");
  assert.equal(recordingButtonLabel({ listening: false, hasText: false, language: "en" }), "Start");
});

test("onboarding voice greeting is user initiated", () => {
  assert.equal(shouldAutoStartRecording({ onboarded: false, screen: "home", modal: "onboarding", attempted: false }), false);
});

test("spoken and calendar dates must agree before saving", () => {
  const spoken = schedule("2026-11-15");
  assert.equal(dateSelectionConflict(spoken, ["2026-11-20"]), true);
  assert.equal(dateSelectionConflict(spoken, ["2026-11-15"]), false);
  assert.equal(dateSelectionConflict(spoken, ["2026-11-20"], false), false);
});

test("a reminder keeps one stable color", () => {
  assert.equal(stableReminderColor("same-id"), stableReminderColor("same-id"));
  assert.notEqual(stableReminderColor("same-id"), stableReminderColor("other-id"));
});

test("time conflict reports the date and occupied time", () => {
  const existing = { id: "old", text: "Позвонить", enabled: true, schedule: schedule("2026-11-15") };
  const candidate = { id: "new", text: "Врач", enabled: true, schedule: schedule("2026-11-15") };
  assert.deepEqual(findTimeConflicts(candidate, [existing]).map(({ date, time }) => ({ date, time })), [
    { date: "2026-11-15", time: "09:00" },
  ]);
});

test("once reminders participate in date conflicts even when their time has passed", () => {
  const existing = {
    id: "old-once",
    text: "Существующее",
    enabled: true,
    schedule: {
      ...defaultSchedule(new Date("2026-11-15T00:00:00Z")),
      kind: "once",
      at: "2026-11-15T09:00:00.000Z",
      timezoneMode: "fixed",
      timezone: "UTC",
    },
  };
  const candidate = { id: "new-once", text: "Новое", enabled: true, schedule: schedule("2026-11-15") };
  assert.deepEqual(findTimeConflicts(candidate, [existing]).map(({ date, time }) => ({ date, time })), [
    { date: "2026-11-15", time: "09:00" },
  ]);
});

test("the thirteenth reminder is blocked while twelve remain allowed", () => {
  const existing = Array.from({ length: 12 }, (_, i) => ({
    id: `old-${i}`,
    text: `Напоминание ${i}`,
    enabled: true,
    schedule: schedule("2026-11-20", `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`),
  }));
  const candidate = { id: "new", text: "Новое", enabled: true, schedule: schedule("2026-11-20", "20:00") };
  assert.deepEqual(findCapacityConflicts(candidate, existing), [{ date: "2026-11-20", count: 12, limit: 12 }]);
  assert.deepEqual(findCapacityConflicts(candidate, existing.slice(0, 11)), []);
});

test("repeating reminders count each occurrence toward the daily limit", () => {
  const existing = Array.from({ length: 11 }, (_, i) => ({
    id: `old-${i}`,
    text: `Напоминание ${i}`,
    enabled: true,
    schedule: schedule("2026-11-20", `${String(8 + i).padStart(2, "0")}:00`),
  }));
  const candidate = {
    id: "new",
    text: "Два раза",
    enabled: true,
    schedule: { ...schedule("2026-11-20", "20:00"), times: ["20:00", "21:00"] },
  };
  assert.deepEqual(findCapacityConflicts(candidate, existing), [
    { date: "2026-11-20", count: 11, limit: 12 },
  ]);
});
