// Прозвучавшее напоминание занимает место в дне бесплатной версии.
//
// Проверяем главное обещание предела: если человек поставил три напоминания,
// дождался их и удалил, четвёртое в этот день поставить уже нельзя. Иначе
// предел обходится в два нажатия и смысла в нём нет.
import test from "node:test";
import assert from "node:assert/strict";
import { assertDailyCapacity } from "../src/domain/day-capacity.js";

const day = "2026-11-26";
const at = (time) => new Date(day + "T" + time + ":00").getTime();

const rule = (id, time = "09:00") => ({
  id,
  text: "напоминание " + id,
  enabled: true,
  schedule: {
    kind: "dates",
    dates: [day],
    times: [time],
    timezoneMode: "fixed",
    timezone: "Asia/Dubai",
  },
});

// Идентификатор срабатывания — тот же, что строит occurrencesInMonth.
const firedId = (id, time) => id + "@" + at(time);

test("три прозвучавших и удалённых закрывают день", () => {
  // Правил не осталось: человек их удалил. Остались только отметки о том,
  // что они прозвучали.
  const fired = {
    [day]: [firedId("a", "09:00"), firedId("b", "10:00"), firedId("c", "11:00")],
  };
  assert.throws(
    () =>
      assertDailyCapacity([], [rule("new", "12:00")], {
        fired,
        maxPerDay: 3,
      }),
    /предел подписки/,
  );
});

test("сообщение говорит прямо, что удаление день не освобождает", () => {
  const fired = {
    [day]: [firedId("a", "09:00"), firedId("b", "10:00"), firedId("c", "11:00")],
  };
  assert.throws(
    () =>
      assertDailyCapacity([], [rule("new", "12:00")], {
        fired,
        maxPerDay: 3,
      }),
    /Удаление их день не освобождает/,
  );
});

test("прозвучавшее и запланированное одного напоминания — одно место", () => {
  // Напоминание «c» стоит на 12:00 и уже прозвучало в 12:00. Планируем его
  // заново на то же время: место то же самое, поэтому день не переполняется.
  const fired = {
    [day]: [firedId("a", "09:00"), firedId("b", "10:00"), firedId("c", "12:00")],
  };
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("c", "12:00")], { fired, maxPerDay: 3 }),
  );
});

test("подписка снимает ограничение", () => {
  const fired = {
    [day]: [firedId("a", "09:00"), firedId("b", "10:00"), firedId("c", "11:00")],
  };
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("new", "12:00")], {
      fired,
      maxPerDay: 24,
    }),
  );
});

test("вчерашние срабатывания не закрывают сегодня", () => {
  const fired = {
    "2026-11-25": [
      firedId("a", "09:00"),
      firedId("b", "10:00"),
      firedId("c", "11:00"),
    ],
  };
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("new", "12:00")], {
      fired,
      maxPerDay: 3,
    }),
  );
});

test("без поля fired предел считается как раньше", () => {
  // Старые сохранения не содержат fired. Это не должно ничего ломать.
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("new", "12:00")], { maxPerDay: 3 }),
  );
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("new", "12:00")], { fired: {}, maxPerDay: 3 }),
  );
});

test("мусор в fired не роняет сохранение", () => {
  // Испорченные данные не должны мешать человеку ставить напоминания.
  assert.doesNotThrow(() =>
    assertDailyCapacity([], [rule("new", "12:00")], {
      fired: { [day]: "не массив" },
      maxPerDay: 3,
    }),
  );
});
