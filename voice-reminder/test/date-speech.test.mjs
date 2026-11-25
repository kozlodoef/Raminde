import test from "node:test";
import assert from "node:assert/strict";

import { parseReminder } from "../src/lib/timeParser.js";
import { parseGroup } from "../src/domain/groups.js";
import { parseEditor } from "../src/domain/home-editor.js";
import { dateSpeechEnabled } from "../src/domain/access.js";

// 25 ноября 2026, 14:15 — «середина дня», вокруг которой считаем «завтра»
// и ближайшие даты.
const NOW = new Date(2026, 10, 25, 14, 15, 0);

const iso = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : null;

const voice = (p) => iso(parseReminder(p, NOW).when);
const saved = (p) => parseGroup(p, [], NOW, { dates: true }).dates;
const editor = (p) => parseEditor(p, { selectedDates: [] }, NOW, { dates: true }).dates;

/** Дата должна совпасть по всем трём путям: голос, сохранение, поле. */
function agree(phrase, date, time = null) {
  const v = voice(phrase);
  assert.equal(v?.slice(0, 10), date, `голос: ${phrase} → ${v}, ждали ${date}`);
  if (time) assert.equal(v.slice(11), time, `голос, время: ${v}`);
  assert.deepEqual(saved(phrase), [date], `сохранение: ${phrase}`);
  assert.deepEqual(editor(phrase), [date], `поле: ${phrase}`);
}

// --- Даты словами ---

test("«завтра» даёт завтрашнюю дату во всех путях", () => {
  agree("напомни завтра в 10:00 позвонить маме", "2026-11-26", "10:00");
});

test("«послезавтра» даёт дату через два дня", () => {
  agree("напомни послезавтра полить цветы", "2026-11-27");
});

test("«сегодня» остаётся сегодня", () => {
  agree("напомни сегодня вечером ужин", "2026-11-25", "19:00");
});

test("день недели: «в пятницу» — ближайшая пятница", () => {
  agree("напомни в пятницу в 9 утра совещание", "2026-11-27", "09:00");
});

test("двадцать пятого декабря — дата, а не время 20:00", () => {
  // Самый частый случай: числительное «двадцать» похоже на час, и раньше
  // голосовой разбор делал из него 20:00 сегодня, а «пятого декабря»
  // уезжало в текст напоминания.
  agree(
    "напомни двадцать пятого декабря в 19:30 купить подарки",
    "2026-12-25",
    "19:30",
  );
});

test("«первого сентября» — будущий год, если день уже прошёл", () => {
  agree("напомни первого сентября в 8 утра линейка", "2027-09-01", "08:00");
});

test("«пятого мая» переносится на следующий год", () => {
  agree("напомни пятого мая поехать на дачу", "2027-05-05");
});

test("дата словами не оставляет следа в тексте напоминания", () => {
  const r = parseReminder(
    "напомни двадцать пятого декабря в 19:30 купить подарки",
    NOW,
  );
  assert.equal(r.text, "Купить подарки");
});

// --- Дата vs время: обороты с порядковым числительным ---

test("«половина одиннадцатого» — время, а не 11-е число", () => {
  // Здесь «одиннадцатого» обозначает час. Если считать это датой, время
  // терялось и напоминание вставало на 11-е число другого месяца.
  const r = parseReminder("напомни в половине одиннадцатого позвонить", NOW);
  assert.equal(r.when.getHours(), 10);
  assert.equal(r.when.getMinutes(), 30);
  // 10:30 сегодня уже прошло (сейчас 14:15), поэтому перенос на завтра —
  // правильное поведение. Главное, что это НЕ 11-е число другого месяца.
  assert.equal(
    Math.round((r.when - NOW) / 86400000),
    1,
    `день уехал: ${r.when}`,
  );
});

test("«четверть седьмого» — время 06:15", () => {
  const r = parseReminder("напомни в четверть седьмого позвонить", NOW);
  assert.equal(r.when.getHours(), 6);
  assert.equal(r.when.getMinutes(), 15);
  assert.equal(
    Math.round((r.when - NOW) / 86400000),
    1,
    `день уехал: ${r.when}`,
  );
});

test("«тридцать минут одиннадцатого» — время 10:30", () => {
  const r = parseReminder(
    "напомни в тридцать минут одиннадцатого позвонить",
    NOW,
  );
  assert.equal(r.when.getHours(), 10);
  assert.equal(r.when.getMinutes(), 30);
  assert.equal(
    Math.round((r.when - NOW) / 86400000),
    1,
    `день уехал: ${r.when}`,
  );
});

// --- Несуществующие даты ---

test("«31 февраля» не превращается в 3 марта", () => {
  // JavaScript молча переносит 31 февраля на 3 марта. Такой даты нет, и
  // напоминание не должно вставать на выдуманный день.
  for (const phrase of [
    "Напомни 31 февраля 2027 в 9 утра позвонить врачу",
    "напомни 30 февраля в 9 утра",
    "напомни 31 апреля в 9 утра",
  ]) {
    const g = parseGroup(phrase, [], NOW, { dates: true });
    assert.ok(
      g.issues.some((e) => /не существует/i.test(e)),
      `нет предупреждения для «${phrase}»: ${JSON.stringify(g.issues)}`,
    );
  }
});

// --- Ограничения версий ---

test("даты из речи больше не привязаны к подписке", () => {
  assert.equal(dateSpeechEnabled(null), true);
  assert.equal(dateSpeechEnabled({ premium: false }), true);
  assert.equal(dateSpeechEnabled({ premium: true }), true);
});
