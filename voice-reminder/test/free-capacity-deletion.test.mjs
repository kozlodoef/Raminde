// Что занимает место в дне бесплатной версии.
//
// Правило: запланированное напоминание место занимает — иначе предел в три
// напоминания ничего не ограничивал бы, и на один день можно было бы
// поставить сколько угодно. Но напоминание, удалённое ДО срабатывания, место
// освобождает: оно ничего не потратило. А прозвучавшее место сохраняет даже
// после удаления — иначе предел обходится в два нажатия «поставить —
// дождаться — удалить», и смысла в нём нет.
//
// Проверяем через реальный путь сохранения (repository.putReminder), а не
// только через assertDailyCapacity: важен не арифметический счёт, а то, что
// удаление, пропуск и перенос действительно освобождают день.
import test from "node:test";
import assert from "node:assert/strict";

import * as repo from "../src/domain/repository.js";
import { occurrencesInMonth } from "../src/domain/groups.js";
import { localDate, zone, zonedTime } from "../src/domain/calendar.js";

const KEY = "raminde.v2";
const LIMIT = 3;

let store;
/** Свежее пустое хранилище: каждый случай проверяется с чистого листа. */
function freshStore() {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
const saved = () => JSON.parse(store.get(KEY) || "null");
const overwrite = (s) => store.set(KEY, JSON.stringify(s));

/** Дата через n дней от сегодняшней. Будущие дни берём, чтобы разовые
 *  напоминания проходили проверку «есть будущее срабатывание». */
const dayAfter = (n) => localDate(new Date(Date.now() + n * 86400000));

/** Напоминание на конкретный день и время. */
function reminder(id, date, time) {
  return {
    id,
    text: "напоминание " + id,
    enabled: true,
    createdAt: Date.now(),
    schedule: {
      kind: "dates",
      dates: [date],
      times: [time],
      timezoneMode: "deviceLocal",
    },
  };
}

/** Сохраняет напоминание; возвращает текст отказа или null при успехе. */
async function add(id, date, time) {
  try {
    await repo.putReminder(reminder(id, date, time), { maxPerDay: LIMIT });
    return null;
  } catch (e) {
    return e.message;
  }
}
async function addOrFail(id, date, time) {
  const message = await add(id, date, time);
  assert.equal(message, null, `«${id}» не поместилось: ${message}`);
}
async function addBlocked(id, date, time) {
  const message = await add(id, date, time);
  assert.ok(message, `«${id}» неожиданно поместилось, хотя день полон`);
  return message;
}

/**
 * Отметка «прозвучало» для дня — то, что остаётся после срабатывания.
 *
 * Хранилище могло быть ещё не создано: тогда берём пустое состояние, как это
 * делает сам репозиторий при первом чтении.
 */
function markFired(date, ids) {
  const s = saved() || repo.emptyState();
  s.fired = { ...(s.fired || {}), [date]: ids };
  overwrite(s);
}
/** Идентификатор срабатывания — тот же, что строит occurrencesInMonth. */
const occurrenceId = (ruleId, date, time) =>
  ruleId + "@" + zonedTime(date, time, zone());

// --- Запланированные занимают место ---

test("три запланированных напоминания закрывают день", async () => {
  // Ни одно ещё не сработало, но день занят: иначе предел не ограничивал бы
  // планирование вовсе — можно было бы поставить двадцать на один день.
  freshStore();
  const d = dayAfter(1);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  const message = await addBlocked("d", d, "13:00");
  assert.match(message, /предел подписки/);
});

test("место в дне считается отдельно для каждого дня", async () => {
  freshStore();
  const d1 = dayAfter(1),
    d2 = dayAfter(2);
  await addOrFail("a", d1, "10:00");
  await addOrFail("b", d1, "11:00");
  await addOrFail("c", d1, "12:00");
  await addBlocked("d", d1, "13:00");
  // Тот же день недели, но другой — там места нет занятых.
  await addOrFail("e", d2, "10:00");
});

// --- Удалённое до срабатывания место освобождает ---

test("удаление до срабатывания освобождает место", async () => {
  // Главное требование: напоминание ничего не потратило, значит и место
  // осталось свободным.
  freshStore();
  const d = dayAfter(1);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  await repo.deleteReminder("a");
  await addOrFail("d", d, "13:00");
  // И день снова полон: освободилось ровно одно место.
  await addBlocked("e", d, "14:00");
});

test("удаление всех запланированных освобождает день", async () => {
  freshStore();
  const d = dayAfter(1);
  for (const [id, time] of [["a", "10:00"], ["b", "11:00"], ["c", "12:00"]])
    await addOrFail(id, d, time);
  for (const id of ["a", "b", "c"]) await repo.deleteReminder(id);
  await addOrFail("new", d, "13:00");
});

test("«Пропустить» будущее срабатывание освобождает место", async () => {
  freshStore();
  const d = dayAfter(1);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  await repo.skipOccurrence("c", zonedTime(d, "12:00", zone()));
  await addOrFail("d", d, "13:00");
});

test("перенос на другой день освобождает прежний", async () => {
  freshStore();
  const d = dayAfter(1),
    other = dayAfter(5);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  const rule = saved().reminders.find((r) => r.id === "c");
  await repo.putReminder(
    { ...rule, schedule: { ...rule.schedule, dates: [other] } },
    { maxPerDay: LIMIT },
  );
  await addOrFail("d", d, "13:00");
});

test("приостановленное напоминание места не занимает", async () => {
  freshStore();
  const d = dayAfter(1);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  const rule = saved().reminders.find((r) => r.id === "c");
  await repo.putReminder({ ...rule, enabled: false }, { maxPerDay: LIMIT });
  await addOrFail("d", d, "13:00");
});

test("убрать одно время из правила освобождает место", async () => {
  freshStore();
  const d = dayAfter(1);
  const id = "multi";
  await repo.putReminder(
    {
      ...reminder(id, d, "10:00"),
      schedule: {
        kind: "dates",
        dates: [d],
        times: ["10:00", "11:00", "12:00"],
        timezoneMode: "deviceLocal",
      },
    },
    { maxPerDay: LIMIT },
  );
  const rule = saved().reminders.find((r) => r.id === id);
  await repo.putReminder(
    { ...rule, schedule: { ...rule.schedule, times: ["10:00", "11:00"] } },
    { maxPerDay: LIMIT },
  );
  await addOrFail("new", d, "13:00");
});

// --- Прозвучавшее место сохраняет ---

test("прозвучавшее и удалённое место не освобождает", async () => {
  // Отметка о срабатывании переживает удаление правила: иначе предел
  // обходится в два нажатия «поставить — дождаться — удалить».
  freshStore();
  const d = dayAfter(1);
  await addOrFail("a", d, "10:00");
  markFired(d, [occurrenceId("a", d, "10:00")]);
  await repo.deleteReminder("a");
  await addOrFail("b", d, "11:00");
  await addOrFail("c", d, "12:00");
  const message = await addBlocked("e", d, "13:00");
  assert.match(message, /предел подписки/);
});

test("прозвучавшее и запланированное одного правила — одно место", async () => {
  // Иначе одно и то же напоминание считалось бы дважды, и день закрывался
  // бы вдвое раньше. Здесь проверяется весь путь сохранения, а не только
  // арифметика assertDailyCapacity.
  freshStore();
  const d = dayAfter(1);
  await addOrFail("c", d, "12:00");
  const occ = occurrencesInMonth(saved().reminders, d.slice(0, 7)).filter(
    (e) => e.reminderId === "c",
  );
  assert.equal(occ.length, 1, "у правила должно быть одно срабатывание");
  markFired(d, [occ[0].id]);
  await addOrFail("a", d, "10:00");
  await addOrFail("b", d, "11:00");
  await addBlocked("d", d, "13:00");
});

test("прозвучавшее в один день не занимает другой", async () => {
  freshStore();
  const d1 = dayAfter(1),
    d2 = dayAfter(2);
  markFired(d1, [
    occurrenceId("a", d1, "10:00"),
    occurrenceId("b", d1, "11:00"),
    occurrenceId("c", d1, "12:00"),
  ]);
  await addOrFail("new", d2, "10:00");
});

test("с подпиской предел не действует", async () => {
  freshStore();
  const d = dayAfter(1);
  for (const [i, time] of ["10:00", "11:00", "12:00", "13:00"].entries())
    await repo.putReminder(reminder("s" + i, d, time), { maxPerDay: 24 });
  assert.equal(saved().reminders.length, 4);
});
