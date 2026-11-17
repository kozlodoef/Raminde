import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { defaultSchedule } from "../src/domain/calendar.js";
import { parseIntents } from "../src/domain/intent.js";
import { unresolvedDraftMessage } from "../src/domain/draftValidation.js";

class MemoryStorage {
  #values = new Map();
  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }
  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }
  removeItem(key) {
    this.#values.delete(String(key));
  }
  clear() {
    this.#values.clear();
  }
}

const storage = new MemoryStorage();
global.localStorage = storage;

const repository = await import("../src/domain/repository.js?repository-test");
const { getState, putReminder, normalizeMode } = repository;

function once(text, at = Date.now() + 60_000) {
  return {
    id: crypto.randomUUID(),
    text,
    enabled: true,
    schedule: { ...defaultSchedule(new Date(at - 60_000)), kind: "once", at: new Date(at).toISOString() },
    createdAt: Date.now(),
  };
}

afterEach(() => storage.clear());

test("web repository saves, reloads, edits, and deletes one rule", async () => {
  const { getState, putReminder, deleteReminder } = repository;
  const reminder = once("Позвонить врачу");
  const saved = await putReminder(reminder);
  assert.equal(saved.reminders.length, 1);
  assert.equal(saved.quota.used, 1);
  assert.equal((await getState()).reminders[0].text, "Позвонить врачу");

  const edited = await putReminder({ ...reminder, text: "Позвонить в клинику" });
  assert.equal(edited.reminders.length, 1);
  assert.equal(edited.quota.used, 1, "editing a rule must not consume quota again");
  assert.equal((await deleteReminder(reminder.id)).reminders.length, 0);
});

test("web repository preserves the parsed time instead of the editor default", async () => {
  const parsed = parseIntents(
    "Напомни 15 ноября 2026 в 14:30 позвонить врачу",
    new Date("2026-10-07T12:00:00Z"),
  )[0];
  const saved = await putReminder({
    ...parsed,
    id: crypto.randomUUID(),
    enabled: true,
    createdAt: Date.now(),
  }, { now: new Date("2026-10-07T12:00:00Z").getTime() });
  assert.equal(saved.reminders[0].schedule.at, parsed.schedule.at);
  assert.equal(new Date(saved.reminders[0].schedule.at).getHours(), 14);
  assert.equal(new Date(saved.reminders[0].schedule.at).getMinutes(), 30);
});

test("web repository stays free beyond ten reminders when billing is not configured", async () => {
  const { putReminder, getState } = repository;
  for (let i = 0; i < 11; i++) await putReminder(once(`Напоминание ${i}`, Date.now() + (i + 1) * 60_000));
  assert.equal((await getState()).reminders.length, 11);
});

test("web fire creates one occurrence and advances a recurring rule once", async () => {
  const { putReminder, getState, fireWeb } = repository;
  const now = Date.now();
  const reminder = {
    ...once("Пить воду", now - 5_000),
    schedule: {
      ...defaultSchedule(new Date(now - 86_400_000)),
      kind: "calendar",
      frequency: "daily",
      anchorDate: new Date(now - 86_400_000).toISOString().slice(0, 10),
      times: [new Date(now - 5_000).toISOString().slice(11, 16)],
      timezoneMode: "fixed",
      timezone: "UTC",
    },
  };
  await putReminder(reminder);
  const stored = JSON.parse(storage.getItem("raminde.v2"));
  stored.reminders[0].nextTriggerAt = now - 5_000;
  storage.setItem("raminde.v2", JSON.stringify(stored));
  const first = await fireWeb();
  assert.equal(first.events.length, 1);
  assert.equal(first.reminders[0].enabled, true);
  const nextTrigger = first.reminders[0].nextTriggerAt;
  const second = await fireWeb();
  assert.equal(second.events.length, 1, "polling the web tab must not duplicate an occurrence");
  assert.equal(second.reminders[0].nextTriggerAt, nextTrigger);
});

test("web repository rejects an enabled rule with no future occurrence", async () => {
  const { putReminder } = repository;
  await assert.rejects(
    putReminder(once("Прошло", Date.now() - 60_000)),
    /будущих дат/,
  );
});

test("web repository saves a corrected finite date set", async () => {
  const draft = parseIntents(
    "Напомни 15 и 20 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.equal(unresolvedDraftMessage(draft.issues), "");
  const saved = await putReminder({
    ...draft,
    id: crypto.randomUUID(),
    enabled: true,
    createdAt: Date.now(),
  });
  assert.deepEqual(saved.reminders[0].schedule.specificDates, [
    "2027-03-15",
    "2027-03-20",
  ]);
});

test("delivery mode is limited to notification and voice+notification", () => {
  assert.equal(normalizeMode("voiceAndNotification"), "voiceAndNotification");
  assert.equal(normalizeMode("notification"), "notification");
  // Отменённый режим «только голос» сохраняет голос и добавляет уведомление.
  assert.equal(normalizeMode("voice"), "voiceAndNotification");
  // Явные «только уведомление» не приводят к озвучиванию вслух.
  assert.equal(normalizeMode("push"), "notification");
  assert.equal(normalizeMode("onlyNotification"), "notification");
  // Отсутствующее значение — значение по умолчанию приложения.
  assert.equal(normalizeMode(undefined), "voiceAndNotification");
});

test("an invalid edit leaves the previously saved finite dates intact", async () => {
  const existing = parseIntents(
    "Напомни 15 и 20 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  const id = crypto.randomUUID();
  await putReminder({ ...existing, id, enabled: true, createdAt: Date.now() });
  const invalidEdit = parseIntents(
    "Напомни 31 февраля 2027 и 15 марта 2027 в 10 позвонить врачу",
    new Date("2026-10-15T12:00:00Z"),
  )[0];
  assert.match(unresolvedDraftMessage(invalidEdit.issues), /Исправьте:/);
  assert.deepEqual(
    (await getState()).reminders.find((r) => r.id === id).schedule.specificDates,
    ["2027-03-15", "2027-03-20"],
  );
});
