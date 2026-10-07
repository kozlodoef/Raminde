// Тесты планировщика напоминаний. Запуск: node test-scheduler.mjs
// Часовой пояс берём как у пользователя (UTC+4), чтобы проверять смену суток.
process.env.TZ = process.env.TZ || 'Asia/Dubai';

import { planTimer, dueReminders, MAX_TIMEOUT } from './src/lib/scheduler.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  → ' + detail : ''}`); }
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (y, m, d, hh, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss, 0).getTime();

console.log('часовой пояс:', Intl.DateTimeFormat().resolvedOptions().timeZone, '\n');

// --- 1. Напоминание на 23:59 того же дня ---
{
  const now = at(2026, 10, 7, 12, 0);
  const when = at(2026, 10, 7, 23, 59);
  const p = planTimer(when, now);
  check('23:59 того же дня → wait', p.kind === 'wait', p.kind);
  check('23:59 задержка = 11ч59м', p.delay === 11 * HOUR + 59 * MIN, p.delay);
}

// --- 2. Переход через сутки: 23:59 → 00:01 ---
{
  const now = at(2026, 10, 7, 23, 59);
  const when = at(2026, 10, 8, 0, 1);          // следующие сутки
  const p = planTimer(when, now);
  check('через полночь (23:59 → 00:01) = 2 мин', p.kind === 'wait' && p.delay === 2 * MIN, `${p.kind} ${p.delay}`);
}

// --- 3. Ровно сейчас ---
{
  const now = at(2026, 10, 7, 12, 0);
  check('ровно сейчас → fire', planTimer(now, now).kind === 'fire');
}

// --- 4. Просроченное (в т.ч. на сутки) ---
{
  const now = at(2026, 10, 7, 12, 0);
  const p = planTimer(at(2026, 10, 6, 9, 0), now);
  check('просроченное на сутки → fire', p.kind === 'fire', p.kind);
  check('просроченное: задержка без переполнения', Number.isSafeInteger(p.delay) && p.delay === 0, p.delay);
}

// --- 5. Граница лимита setTimeout ---
{
  const now = at(2026, 10, 7, 12, 0);
  check('ровно на лимите → wait', planTimer(now + MAX_TIMEOUT, now).kind === 'wait');
  check('на 1 мс больше лимита → defer', planTimer(now + MAX_TIMEOUT + 1, now).kind === 'defer');
}

// --- 6. Очень далёкое будущее ---
{
  const now = at(2026, 10, 7, 12, 0);
  const p = planTimer(at(2027, 10, 7, 12, 0), now);   // +1 год
  check('через год → defer', p.kind === 'defer', p.kind);
  check('defer: задержка = MAX_TIMEOUT', p.delay === MAX_TIMEOUT, p.delay);
  const yearMs = 365 * DAY;
  check('год > лимита (запас корректен)', yearMs > MAX_TIMEOUT, `${yearMs} vs ${MAX_TIMEOUT}`);
}

// --- 7. Некорректные данные не должны ставить «мгновенный» таймер ---
{
  const now = at(2026, 10, 7, 12, 0);
  for (const bad of ['не дата', '', null, undefined, {}, NaN]) {
    const p = planTimer(bad, now);
    check(`некорректная дата (${JSON.stringify(bad) ?? 'undefined'}) → invalid`, p.kind === 'invalid', p.kind);
  }
}

// --- 8. Строки ISO (как хранит приложение) ---
{
  const now = at(2026, 10, 7, 12, 0);
  const iso = new Date(at(2026, 10, 7, 13, 30)).toISOString();
  const p = planTimer(iso, now);
  check('ISO-строка → wait 1ч30м', p.kind === 'wait' && p.delay === 90 * MIN, `${p.kind} ${p.delay}`);
  check('ISO-строка просрочена → fire', planTimer(new Date(now - 1000).toISOString(), now).kind === 'fire');
}

// --- 9. dueReminders: что показывать сразу ---
{
  const now = at(2026, 10, 7, 12, 0);
  const list = [
    { id: 'a', when: new Date(now - 5000).toISOString(), done: false },   // просрочено
    { id: 'b', when: new Date(now + HOUR).toISOString(), done: false },    // в будущем
    { id: 'c', when: new Date(now - 5000).toISOString(), done: true },     // выполнено
    { id: 'd', when: 'мусор', done: false },                               // битая дата
    { id: 'e', when: new Date(now).toISOString(), done: false },           // ровно сейчас
  ];
  const due = dueReminders(list, now).map((r) => r.id);
  check('dueReminders: только просроченные и активные', JSON.stringify(due) === JSON.stringify(['a', 'e']), JSON.stringify(due));
  check('dueReminders: пустой список безопасен', dueReminders([], now).length === 0);
  check('dueReminders: undefined безопасен', dueReminders(undefined, now).length === 0);
}

// --- 10. Смена суток на границе месяца и года ---
{
  const now = at(2026, 12, 31, 23, 30);
  const when = at(2027, 1, 1, 0, 15);
  const p = planTimer(when, now);
  check('через Новый год = 45 мин', p.kind === 'wait' && p.delay === 45 * MIN, `${p.kind} ${p.delay}`);
}

console.log(`\nПройдено: ${pass}, Провалено: ${fail}`);
process.exit(fail ? 1 : 0);
