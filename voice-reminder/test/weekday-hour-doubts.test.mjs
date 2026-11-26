// Тесты новых оборотов даты и времени и порога уверенности.
//
// Что здесь проверяется и почему именно так.
//
// 1. Указатели при дне недели. «В эту пятницу» и «в следующий вторник» давали
//    верную дату, но слово «эту» / «следующий» оставалось в тексте
//    напоминания: человек видел «Позвонить маме эту». Проверяем и дату, и
//    текст: дата и раньше считалась верно, поэтому одного текста мало.
//
// 2. «В час». Оборот не распознавался вовсе: «в час позвонить» уходило в
//    текст напоминания, а время оставалось пустым. «В час» — это и 13:00, и
//    01:00, поэтому разбор помечается как неуверенный, а приложение
//    переспрашивает (см. ConfirmTimeModal).
//
// 3. «В конце недели» — договорённость: пятница 18:00. Время вынесено в
//    константу END_OF_WEEK_DEFAULT, чтобы его можно было поменять.
//
// 4. Порог уверенности. Разбор формально верный, но двусмысленный, не должен
//    считаться твёрдым: «в час» — 0.7, обычная фраза — 1.0.
import test from "node:test";
import assert from "node:assert/strict";

import { parseReminder } from "../src/lib/timeParser.js";
import { parseGroup, dropDateWords } from "../src/domain/groups.js";
import { parseEditor, editorPhrase } from "../src/domain/home-editor.js";
import { parseIntent, CONFIDENCE_THRESHOLD, countDateCandidates } from "../src/domain/intent.js";
import { toDigits } from "../src/domain/phrase-digits.js";
import { blank, applyHourChoice, wantsTimeConfirm } from "../src/domain/draft-model.js";
import { END_OF_WEEK_DEFAULT } from "../src/lib/timeParser.js";

// Четверг 26 ноября 2026, 14:20 — «сейчас» из ответов по разбору дат.
// Четверг удобен тем, что «эта пятница» и «следующий вторник» дают разные
// даты: 27.11 и 01.12.
const NOW = new Date(2026, 10, 26, 14, 20, 0);
const p2 = (n) => String(n).padStart(2, "0");
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const day = (d) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;

/** Дата, на которую встанет напоминание. */
function dateOf(phrase) {
  const r = parseReminder("напомни " + phrase, NOW);
  return day(r.when);
}

/** Текст действия, который сохранится. */
function textOf(phrase) {
  const g = parseGroup(phrase, [], NOW, { dates: true });
  return g.text;
}

// --- 1. Указатели при дне недели ---

test("«в эту пятницу» — верная дата, а указатель не остаётся в тексте", () => {
  // 27.11.2026 — пятница. Указатель «эту» раньше уезжал в текст действия.
  assert.equal(dateOf("в эту пятницу позвонить маме"), "27.11");
  assert.equal(textOf("в эту пятницу позвонить маме"), "Позвонить маме");
});

test("«в следующий вторник» — верная дата без слова «следующий»", () => {
  // После четверга 26.11 ближайший вторник — 01.12.
  assert.equal(dateOf("в следующий вторник купить хлеб"), "01.12");
  assert.equal(textOf("в следующий вторник купить хлеб"), "Купить хлеб");
});

test("день недели без указателя работает как раньше", () => {
  assert.equal(dateOf("в пятницу позвонить"), "27.11");
  assert.equal(textOf("в пятницу позвонить"), "Позвонить");
});

test("все падежи и все указатели дня недели дают верную дату", () => {
  // Дата одна и та же, меняются только форма слова и указатель. Текст во
  // всех случаях должен остаться чистым.
  const variants = [
    "в пятницу позвонить",
    "в эту пятницу позвонить",
    "в ближайшую пятницу позвонить",
    "в следующую пятницу позвонить",
    "пятницу позвонить",
    "по пятницам позвонить", // повтор — разбирается отдельной веткой
  ];
  for (const phrase of variants)
    assert.equal(dateOf(phrase), "27.11", `дата в «${phrase}»`);
  const clean = [
    "в эту пятницу позвонить",
    "в этот вторник позвонить",
    "в ближайший вторник позвонить",
    "в следующую пятницу позвонить",
    "в следующий понедельник позвонить",
    "в среду позвонить",
    "в четверг позвонить",
    "в субботу позвонить",
    "в воскресенье позвонить",
  ];
  for (const phrase of clean)
    assert.equal(textOf(phrase), "Позвонить", `текст в «${phrase}»`);
});

test("указатель не съедает соседние слова", () => {
  // «Эту» — ещё и форма местоимения. Убеждаемся, что вырезается только
  // указатель при дне недели, а не первое попавшееся слово.
  assert.equal(textOf("в эту пятницу купить эту книгу"), "Купить эту книгу");
});

test("dropDateWords убирает указатель и в бесплатной версии", () => {
  // Без разбора дат слова даты снимаются отдельной функцией. Если бы она
  // знала только «следующий», «эту» попадала бы в текст напоминания.
  assert.equal(
    dropDateWords("в эту пятницу позвонить маме").replace(/\s+/g, " ").trim(),
    "позвонить маме",
  );
  assert.equal(
    dropDateWords("в следующий вторник купить хлеб").replace(/\s+/g, " ").trim(),
    "купить хлеб",
  );
});

// --- 2. «В час» ---

test("«в час» — 13:00 и признак двусмысленности", () => {
  const r = parseReminder("напомни в час позвонить", NOW);
  assert.equal(hm(r.when), "13:00", "дневное чтение по умолчанию");
  assert.equal(r.text, "Позвонить", "слово «час» не остаётся в тексте");
  assert.equal(r.ambiguous, true, "нужен переспрос");
  assert.deepEqual(r.choices, ["13:00", "01:00"], "оба варианта для переспроса");
});

test("«в час дня» и «в час ночи» — уверенно, без переспроса", () => {
  const d = parseReminder("напомни в час дня позвонить", NOW);
  assert.equal(hm(d.when), "13:00");
  assert.equal(d.ambiguous, false);
  assert.equal(d.text, "Позвонить");

  const n = parseReminder("напомни в час ночи позвонить", NOW);
  assert.equal(hm(n.when), "01:00");
  assert.equal(n.ambiguous, false);
  assert.equal(n.text, "Позвонить");
});

test("«в 3» читается днём, но помечается как двусмысленное", () => {
  const r = parseReminder("напомни в 3 позвонить", NOW);
  assert.equal(hm(r.when), "15:00");
  assert.equal(r.ambiguous, true);
});

test("«в 3 дня» и «в 5 утра» двусмысленности не дают", () => {
  assert.equal(parseReminder("напомни в 3 дня позвонить", NOW).ambiguous, false);
  assert.equal(parseReminder("напомни в 5 утра позвонить", NOW).ambiguous, false);
});

test("обороты «без N час» не считаются двусмысленными", () => {
  // «Без четверти шесть» — это 05:45, а не 17:45: так говорят про утро,
  // и вопроса «день или ночь» здесь не возникает. Если бы признак ставился
  // по получившемуся часу (5), оборот превращался бы в 17:45.
  const r = parseReminder("напомни без четверти шесть позвонить", NOW);
  assert.equal(hm(r.when), "05:45");
  assert.equal(r.ambiguous, false);
});

test("«полчетвёртого» — днём, с переспросом", () => {
  // Раньше давало 03:30 без единого вопроса, хотя днём имеется в виду 15:30.
  const r = parseReminder("напомни полчетвёртого полить цветы", NOW);
  assert.equal(hm(r.when), "15:30");
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.choices, ["15:30", "03:30"]);
});

test("«в четверть седьмого» остаётся утренним", () => {
  // Здесь назван седьмой час — он вне диапазона 1–5, двусмысленности нет.
  const r = parseReminder("напомни в четверть седьмого позвонить", NOW);
  assert.equal(hm(r.when), "06:15");
  assert.equal(r.ambiguous, false);
});

test("выбор варианта переносится в черновик", () => {
  // Переспрос бесполезен, если выбор не доходит до расписания: напоминание
  // сработало бы по 13:00, а человек выбрал 01:00.
  const draft = parseEditor("в час позвонить", blank(), NOW, { dates: true });
  assert.deepEqual(draft.times, ["13:00"]);
  const night = applyHourChoice(draft, "01:00", "13:00");
  assert.deepEqual(night.times, ["01:00"], "время в списке");
  assert.deepEqual(night.schedule.times, ["01:00"], "время в расписании");
  // В поле ввода видно выбранное чтение, а не прежнее.
  const shown = toDigits(editorPhrase(night, NOW), night, NOW);
  assert.match(shown, /01:00/, `поле: ${JSON.stringify(shown)}`);
  assert.ok(!/13:00/u.test(shown), `старое время осталось: ${JSON.stringify(shown)}`);
});

test("выбор варианта меняет время и в разовом расписании", () => {
  // У разового правила («через два часа», «сегодня в 10») время лежит в at.
  // Если его не поправить, человек выберет 01:00, а сработает в 13:00.
  const draft = {
    ...blank(),
    phrase: "в час позвонить",
    times: ["13:00"],
    doubts: [{ kind: "hour", choices: ["13:00", "01:00"], chosen: "13:00" }],
    schedule: {
      kind: "once",
      at: new Date(2026, 10, 26, 13, 0, 0).toISOString(),
      times: ["13:00"],
    },
  };
  const next = applyHourChoice(draft, "01:00", "13:00");
  const after = new Date(next.schedule.at);
  assert.equal(p2(after.getHours()), "01", "час в разовом расписании");
  assert.equal(p2(after.getMinutes()), "00");
  assert.deepEqual(next.times, ["01:00"]);
});

test("в поле ввода «в час» показывается цифрами", () => {
  const draft = parseEditor("в час позвонить", blank(), NOW, { dates: true });
  const shown = toDigits("в час позвонить", draft, NOW);
  assert.match(shown, /13:00/, `поле: ${JSON.stringify(shown)}`);
  assert.ok(!/\bчас\b/u.test(shown), `слово «час» осталось: ${JSON.stringify(shown)}`);
});

// --- 3. «В конце недели» ---

test("«в конце недели» — пятница 18:00", () => {
  const r = parseReminder("напомни в конце недели позвонить", NOW);
  assert.equal(day(r.when), "27.11");
  assert.equal(hm(r.when), "18:00");
  assert.equal(r.text, "Позвонить");
});

test("«в конце недели» сохраняется как дата и время", () => {
  const g = parseGroup("в конце недели позвонить", [], NOW, { dates: true });
  assert.deepEqual(g.times, ["18:00"]);
  assert.deepEqual(g.dates, ["2026-11-27"]);
  assert.equal(g.text, "Позвонить");
});

test("время «в конце недели» вынесено в константу", () => {
  // Договорённость о поведении, а не факт языка: её могут поменять.
  assert.equal(END_OF_WEEK_DEFAULT.weekday, 5);
  assert.equal(END_OF_WEEK_DEFAULT.hour, 18);
  assert.equal(END_OF_WEEK_DEFAULT.minute, 0);
});

test("названное время перебивает значение по умолчанию", () => {
  const r = parseReminder("напомни в конце недели в 10 утра позвонить", NOW);
  assert.equal(day(r.when), "27.11");
  assert.equal(hm(r.when), "10:00");
  assert.equal(r.timeIsDefault, false);
});

test("«в конце недели» убирается из текста и в бесплатной версии", () => {
  assert.equal(
    dropDateWords("в конце недели позвонить").replace(/\s+/g, " ").trim(),
    "позвонить",
  );
});

// --- 4. Порог уверенности ---

test("обычная фраза разобрана уверенно", () => {
  const i = parseIntent("завтра в семь утра полить цветы", NOW);
  assert.equal(i.confidence, 1);
  assert.equal(i.needsConfirmation, false);
  assert.deepEqual(i.doubts, []);
});

test("двусмысленный час опускает уверенность ниже порога", () => {
  const i = parseIntent("в час позвонить", NOW);
  assert.equal(i.confidence, 0.7);
  assert.ok(i.confidence < CONFIDENCE_THRESHOLD, "порог должен срабатывать");
  assert.equal(i.needsConfirmation, true);
  const hour = i.doubts.find((d) => d.kind === "hour");
  assert.ok(hour, "сомнение по часу");
  assert.deepEqual(hour.choices, ["13:00", "01:00"]);
  assert.equal(hour.chosen, "13:00", "дневное чтение выбрано заранее");
});

test("«полчетвёртого» тоже требует подтверждения", () => {
  const i = parseIntent("полчетвёртого полить цветы", NOW);
  assert.equal(i.confidence, 0.7);
  assert.equal(i.needsConfirmation, true);
  assert.deepEqual(i.doubts.map((d) => d.kind), ["hour"]);
});

test("сомнение по часу доходит до черновика, а не теряется", () => {
  // Фраза переписывается цифрами перед разбором, поэтому признак снимается
  // с исходного текста и проводится наверх. Без этого до модалки не доходило:
  // «в час» превращалось в «в 13:00», и разбор выглядел уверенным.
  for (const [phrase, chosen, options] of [
    ["в час позвонить", "13:00", ["13:00", "01:00"]],
    ["полчетвёртого полить цветы", "15:30", ["15:30", "03:30"]],
    ["в 3 позвонить", "15:00", ["15:00", "03:00"]],
  ]) {
    const draft = parseEditor(phrase, blank(), NOW, { dates: true });
    const hour = draft.doubts?.find((d) => d.kind === "hour");
    assert.ok(hour, `сомнение потерялось в «${phrase}»`);
    assert.deepEqual(hour.choices, options, `варианты в «${phrase}»`);
    assert.equal(hour.chosen, chosen, `выбранное по умолчанию в «${phrase}»`);
    assert.equal(draft.confidence, 0.7, `уверенность в «${phrase}»`);
    assert.equal(draft.needsConfirmation, true, `порог в «${phrase}»`);
  }
});

test("названная часть суток снимает сомнение — и после перезаписи тоже", () => {
  // Здесь признак нельзя определять по переписанной строке: «в час ночи»
  // становится «в 01:00», то есть выглядит как двусмысленный час 1.
  // Поэтому «часть суток названа» запоминается до перезаписи.
  for (const phrase of [
    "в час дня позвонить",
    "в час ночи позвонить",
    "в 3 дня позвонить",
    "в 5 утра позвонить",
  ]) {
    const draft = parseEditor(phrase, blank(), NOW, { dates: true });
    assert.deepEqual(draft.doubts, [], `сомнение в «${phrase}»`);
    assert.equal(draft.confidence, 1, `уверенность в «${phrase}»`);
  }
});

test("явная запись с минутами не считается двусмысленной", () => {
  for (const phrase of ["в 13:00 позвонить", "в 01:00 позвонить", "в 1.30 позвонить"]) {
    const draft = parseEditor(phrase, blank(), NOW, { dates: true });
    assert.deepEqual(draft.doubts, [], `сомнение в «${phrase}»`);
  }
});

test("окно подтверждения показывается ровно там, где нужно", () => {
  // Правило решает, спрашивать ли человека перед сохранением. Ошибка в обе
  // стороны дорогая: лишний вопрос на каждой обычной фразе или пропущенный —
  // и напоминание сработает не на то время.
  const cases = [
    // [фраза, ждём ли окно]
    ["в час позвонить", true],
    ["полчетвёртого полить цветы", true],
    ["в 3 позвонить", true],
    ["в час дня позвонить", false],
    ["в час ночи позвонить", false],
    ["без четверти шесть позвонить", false],
    ["в конце недели позвонить", false],
    ["завтра в семь утра полить цветы", false],
    ["25 декабря в 19:30 купить подарки", false],
  ];
  for (const [phrase, expected] of cases) {
    const draft = parseEditor(phrase, blank(), NOW, { dates: true });
    assert.equal(
      wantsTimeConfirm(draft),
      expected,
      `окно для «${phrase}»: doubts=${JSON.stringify(draft.doubts)}`,
    );
  }
});

test("вопрос о датах задаётся только когда дата уже известна", () => {
  // Без выбранной даты спрашивать о ней преждевременно: сначала время.
  const both = {
    ...blank(),
    doubts: [{ kind: "dates", count: 2, chosen: null }],
    dates: [],
    selectedDates: [],
  };
  assert.equal(wantsTimeConfirm(both), false, "дата ещё не выбрана");
  assert.equal(
    wantsTimeConfirm({ ...both, dates: ["2026-11-27"] }),
    true,
    "дата из фразы — можно спрашивать",
  );
  assert.equal(
    wantsTimeConfirm({ ...both, selectedDates: ["2026-11-27"] }),
    true,
    "дата отмечена на календаре",
  );
});

test("«в час дня» подтверждения не требует", () => {
  const i = parseIntent("в час дня позвонить", NOW);
  assert.equal(i.confidence, 1);
  assert.deepEqual(i.doubts, []);
});

test("«в конце недели» подтверждения не требует", () => {
  const i = parseIntent("в конце недели позвонить", NOW);
  assert.equal(i.confidence, 1);
  assert.deepEqual(i.doubts, []);
});

test("несколько дат во фразе — отдельное сомнение", () => {
  const i = parseIntent("в пятницу и в субботу гости", NOW);
  assert.equal(i.needsConfirmation, true);
  const dates = i.doubts.find((d) => d.kind === "dates");
  assert.ok(dates, "сомнение по датам");
  assert.equal(dates.count, 2);
});

test("одна дата сомнений по датам не даёт", () => {
  for (const phrase of [
    "завтра в 7 позвонить",
    "25 декабря в 19:30 купить подарки",
    "двадцать пятого декабря в 19:30 купить подарок",
    "в эту пятницу позвонить маме",
  ])
    assert.equal(
      countDateCandidates(phrase),
      1,
      `дат в «${phrase}»`,
    );
});

test("подсчёт дат не считает временем и оборотами повтора", () => {
  assert.equal(countDateCandidates("через два часа позвонить"), 0);
  assert.equal(countDateCandidates("поесть в 16:30"), 0);
  assert.equal(countDateCandidates("каждый понедельник в 9 утра напомни"), 1);
});

test("порог уверенности — 0.75, и он один на всё приложение", () => {
  // Проверка смысла, а не числа: один вопрос по часу обязан его перебивать.
  assert.equal(CONFIDENCE_THRESHOLD, 0.75);
});

test("прежний строковый признак остался для совместимости", () => {
  assert.equal(parseIntent("купить хлеб", NOW).legacy, "needsConfirmation");
  assert.equal(parseIntent("завтра в 7 купить хлеб", NOW).legacy, "parsed");
});

// --- 5. Новые формы в каталоге времени ---

test("«в час дня» и «в час ночи» понимают все пути", () => {
  // Голос, сохранение и поле ввода должны давать одно время — как и для форм
  // из TIME_FORMS.
  const cases = [
    ["напомни в час дня позвонить", "13:00"],
    ["напомни в час ночи позвонить", "01:00"],
  ];
  for (const [phrase, expected] of cases) {
    assert.equal(hm(parseReminder(phrase, NOW).when), expected, `голос: ${phrase}`);
    const g = parseGroup(phrase, [], NOW, { dates: false });
    assert.deepEqual(g.times, [expected], `сохраняется: ${phrase}`);
    const draft = parseEditor(phrase, blank(), NOW, { dates: false });
    assert.deepEqual(draft.times, [expected], `редактор: ${phrase}`);
  }
});
