// Регрессия: минуты словами/цифрами после точного часа («16:00 тридцать»,
// «шестнадцать тридцать», «16 двадцать пять») должны дополнять время, а не
// оставаться в тексте напоминания.
import test from "node:test";
import assert from "node:assert/strict";
import { parseReminder } from "../src/lib/timeParser.js";

// Фиксированные «сейчас»: полдень, чтобы все времена впереди.
const now = new Date("2026-11-24T12:00:00");
const p = (n) => String(n).padStart(2, "0");
const hm = (d) => `${p(d.getHours())}:${p(d.getMinutes())}`;
const day = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

function parsed(phrase) {
  const r = parseReminder(phrase, now);
  return { hm: hm(r.when), day: day(r.when), tf: r.timeFound, text: r.text };
}

test("«16:30» остаётся 16:30 (базовый случай)", () => {
  const r = parsed("напомни поесть картошки в 16:30");
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Поесть картошки");
});

test("«16:00 тридцать» дополняется до 16:30", () => {
  const r = parsed("напомни поесть картошки в 16:00 тридцать");
  assert.equal(r.tf, true);
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Поесть картошки");
});

test("«шестнадцать тридцать» — часы словами, минуты словами", () => {
  const r = parsed("напомни в шестнадцать тридцать поесть картошки");
  assert.equal(r.tf, true);
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Поесть картошки");
});

test("«16 тридцать» — часы цифрами, минуты словами", () => {
  const r = parsed("напомни в 16 тридцать покушать");
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Покушать");
});

test("«16 двадцать пять» — составное число минут", () => {
  const r = parsed("напомни в 16 двадцать пять покушать");
  assert.equal(r.hm, "16:25");
  assert.equal(r.text, "Покушать");
});

test("«19:00 пятнадцать» — цифры + слово-минуты", () => {
  const r = parsed("напомни в 19:00 пятнадцать покушать");
  assert.equal(r.hm, "19:15");
  assert.equal(r.text, "Покушать");
});

test("«16 тридцать минут» — слово «минут» не остаётся в тексте", () => {
  const r = parsed("напомни в 16 тридцать минут покушать");
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Покушать");
});

test("«16:00» без минут не меняется", () => {
  const r = parsed("напомни в 16:00 покушать");
  assert.equal(r.hm, "16:00");
  assert.equal(r.text, "Покушать");
});

test("«через тридцать минут» остаётся отсчётом, а не минутами", () => {
  const r = parsed("напомни через тридцать минут покушать");
  assert.equal(r.hm, "12:30"); // 12:00 + 30 минут
  assert.equal(r.text, "Покушать");
});

test("«25 мая в 16:00 тридцать» — дата и время дополнения вместе", () => {
  const r = parsed("напомни 25 мая в 16:00 тридцать");
  assert.equal(r.day, "2027-05-25"); // май 2026 уже прошёл
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Напоминание");
});

test("«в 16 25 мая» — цифра 25 остаётся днём даты, а не минутой", () => {
  const r = parsed("напомни в 16 25 мая покушать");
  assert.equal(r.day, "2027-05-25");
  assert.equal(r.hm, "16:00");
  assert.equal(r.text, "Покушать");
});

test("минуты словом перед глаголом действия применяются", () => {
  const r = parsed("напомни в 16:00 тридцать позвонить маме");
  assert.equal(r.hm, "16:30");
  assert.equal(r.text, "Позвонить маме");
});

test("«в 8 два хлеба» — «два» это количество, а не минуты", () => {
  const r = parsed("напомни в 8 два хлеба купить");
  assert.equal(r.hm, "08:00");
  assert.equal(r.text, "Два хлеба купить");
});

test("«16:00 тридцать человек» — «тридцать» это количество", () => {
  const r = parsed("напомни в 16:00 тридцать человек придут");
  assert.equal(r.hm, "16:00");
  assert.equal(r.text, "Тридцать человек придут");
});

test("«восемнадцать часов тридцать» — часы словами без предлога", () => {
  const r = parsed("напомни в восемнадцать часов тридцать полить цветы");
  assert.equal(r.hm, "18:30");
  assert.equal(r.text, "Полить цветы");
});

test("«20:00 сорок пять» — составное время", () => {
  const r = parsed("напомни в 20:00 сорок пять покушать");
  assert.equal(r.hm, "20:45");
  assert.equal(r.text, "Покушать");
});

test("«16:00 ноль» — слово «ноль» не остаётся в тексте", () => {
  const r = parsed("напомни в 16:00 ноль покушать");
  assert.equal(r.hm, "16:00");
  assert.equal(r.text, "Покушать");
});
