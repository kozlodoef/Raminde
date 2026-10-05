import { parseReminder } from './src/lib/timeParser.js';

const now = new Date();
const p = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const at = (dayShift, h, m = 0) => { const d = addDays(now, dayShift); d.setHours(h, m, 0, 0); return fmt(d); };

// [фраза, ожидаемое "когда", ожидаемый текст действия]
const cases = [
  ['Напомни мне завтра в семь утра полить цветы', at(1, 7), 'Полить цветы'],
  ['Напомнить через два часа позвонить маме', fmt(new Date(now.getTime() + 2 * 3600e3)), 'Позвонить маме'],
  ['напомни 15 октября в 10 утра сдать отчёт', at(0, 0).slice(0,4) + '-10-15 10:00', 'Сдать отчет'],
  ['напомни сегодня без четверти шесть забрать ребёнка из школы', null, 'Забрать ребенка из школы'], // зависит от текущего времени
  ['Напомни завтра в половине десятого позвонить врачу', at(1, 9, 30), 'Позвонить врачу'],
  ['напомни через полчаса выпить таблетки', fmt(new Date(now.getTime() + 30 * 60e3)), 'Выпить таблетки'],
  ['Напомни послезавтра в 3 дня встречу с директором', at(2, 15), 'Встречу с директором'],
  ['Напомни в десять вечера позвонить бабушке', null, 'Позвонить бабушке'], // сегодня или завтра — зависит от времени
  ['Напомни в 15:30 созвониться с командой', null, 'Созвониться с командой'],
  ['Напомни полшестого вечером покормить кота', null, 'Покормить кота'],
  ['Напомни в пятницу утром стирку', null, 'Стирку'],
];

let pass = 0, fail = 0;
for (const [phrase, expectWhen, expectText] of cases) {
  const r = parseReminder(phrase);
  const got = fmt(r.when);
  const okTime = !expectWhen || got === expectWhen;
  const okText = r.text.toLowerCase().includes(expectText.toLowerCase().slice(0, 8));
  if (okTime && okText) { pass++; console.log(`✅ "${phrase}"\n     → ${got} | "${r.text}"`); }
  else { fail++; console.log(`❌ "${phrase}"\n     → ${got} | "${r.text}" (ожидалось ${expectWhen || '—'} | ${expectText})`); }
}
console.log(`\nПройдено: ${pass}, Провалено: ${fail}`);
process.exit(fail ? 1 : 0);
