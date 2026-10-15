import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { defaultSchedule } from "../src/domain/calendar.js";

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
