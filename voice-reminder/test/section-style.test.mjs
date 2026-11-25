// Единый вид разделов и отсутствие системных элементов Android.
//
// Дефекты, которые здесь закреплены:
//  • заголовки разделов имели разный размер («События» 26 px, «Настройки»
//    42 px) — на переходе между экранами заголовок прыгал;
//  • <select> и <input type="number"> не имели appearance: none, поэтому
//    Android рисовал их по-своему: системная стрелка, счётчики у чисел,
//    свои отступы и серый фон — чужая вставка на бумажной палитре;
//  • автозаполнение Chrome красило поля в жёлтый;
//  • карточки разделов имели разный радиус (28 и 16) и разную плотность.
//
// Проверка идёт по исходникам CSS и разметки: рендер в node без DOM не
// проверить, а сами правила — обычный текст.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = (name) =>
  readFile(new URL("../src/" + name, import.meta.url), "utf8");
const [sections, styles, theme, planner, agenda, main, app] = await Promise.all([
  css("sections.css"),
  css("styles.css"),
  css("theme.css"),
  css("planner.css"),
  css("agenda.css"),
  readFile(new URL("../src/main.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
]);

// --- Порядок подключения ---

test("sections.css подключается последним", () => {
  // От порядка зависит, чьё правило победит при равной специфичности.
  // Файл должен идти после theme.css и focus-home.css, иначе его правила
  // перекроет ранний слой — ровно так и было с заголовком «События».
  const at = main.indexOf("sections.css");
  assert.ok(at > 0, "sections.css не подключён");
  for (const earlier of ["styles.css", "theme.css", "focus-home.css"])
    assert.ok(
      main.indexOf(earlier) < at,
      `${earlier} должен подключаться раньше sections.css`,
    );
});

// --- Заголовки разделов ---

test("заголовки обоих разделов одного размера", () => {
  assert.match(sections, /\.page-title h1[\s\S]{0,200}font-size: 30px/);
  // Старое правило «События» 26 px не должно перебивать: у нового слоя
  // селектор с двумя классами и он идёт последним.
  assert.match(sections, /\.events-title h1/);
});

test("кнопка возврата одна на оба раздела", () => {
  assert.match(sections, /\.page-title \.text-button/);
  // В разметке обе кнопки должны называться одинаково: «Главная» в
  // «Событиях» и «Главная» в «Настройках» читались как два разных действия.
  //
  // Подпись берём как последний текстовый узел кнопки: перед ней стоит
  // обработчик onClick, и простое «вырезать теги» захватывает его код.
  const labels = [
    ...app.matchAll(/className="text-button back-home"[\s\S]*?<\/button>/g),
  ]
    .map((m) =>
      m[0]
        .replace(/<[^>]+>/g, "\n")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop(),
    );
  assert.equal(labels.length, 2, "кнопок возврата не две: " + labels.length);
  assert.equal(
    new Set(labels).size,
    1,
    "подписи кнопки возврата различаются: " + JSON.stringify(labels),
  );
  assert.equal(labels[0], "← Назад");
});

// --- Системные элементы ---

test("список select оформлен, а не системный", () => {
  assert.match(sections, /\.field select[\s\S]{0,400}appearance: none/);
  assert.match(sections, /-webkit-appearance: none/);
  // Своя стрелка вместо системной.
  assert.match(sections, /background-image: url\("data:image\/svg\+xml/);
});

test("у числовых полей нет системных счётчиков", () => {
  assert.match(sections, /input\[type="number"\][\s\S]{0,200}appearance: textfield/);
  assert.match(sections, /::-webkit-inner-spin-button/);
  assert.match(sections, /::-webkit-outer-spin-button/);
});

test("автозаполнение не красит поле в жёлтый", () => {
  assert.match(sections, /-webkit-autofill[\s\S]{0,200}-webkit-box-shadow/);
});

test("системная полоса прокрутки убрана", () => {
  assert.match(sections, /::-webkit-scrollbar[\s\S]{0,80}width: 0/);
});

test("подсветка нажатия браузера отключена", () => {
  assert.match(sections, /-webkit-tap-highlight-color: transparent/);
});

// --- Единая геометрия ---

test("карточки разделов имеют один радиус и одну границу", () => {
  const card = sections.match(/\.planner \.settings-card \{[\s\S]*?\}/);
  assert.ok(card, "правило карточки настроек не найдено");
  assert.match(card[0], /border-radius: 20px/);
  assert.match(card[0], /border: 1px solid var\(--line\)/);

  const agendaCard = sections.match(/\.planner \.agenda \.agenda-card \{[\s\S]*?\}/);
  assert.ok(agendaCard, "правило карточки события не найдено");
  assert.match(agendaCard[0], /border-radius: 20px/);
});

test("строка настройки с тумблером размечена одинаково", () => {
  assert.match(sections, /\.setting-row \{[\s\S]{0,300}justify-content: space-between/);
  assert.match(sections, /\.setting-row strong[\s\S]{0,120}font-size: 15px/);
});

test("кнопки в карточке не наезжают друг на друга", () => {
  // Правило ширины не должно применяться к текстовым кнопкам: у них своя
  // геометрия (строка меню), и нижнее поле сбивало ритм.
  assert.match(
    sections,
    /button\.full:not\(\.text-button\)/,
    "правило .full перебивает текстовые кнопки",
  );
});

// --- Свои элементы управления не сломаны ---

test("тумблер остаётся своим, а не системным чекбоксом", () => {
  assert.match(styles, /\.toggle \{[\s\S]*?appearance: none/);
  assert.match(theme, /\.toggle:checked/);
});

test("переключатель событий остаётся своим", () => {
  assert.match(agenda, /\.agenda-switch input[\s\S]{0,120}opacity: 0/);
  assert.match(agenda, /\.agenda-switch > span/);
});

test("календарь не переопределён новым слоем", () => {
  // sections.css не должен трогать кольца и дни: они уже оформлены.
  assert.ok(!/\.ring-day/.test(sections), "sections.css трогает календарь");
  assert.ok(!/\.day\.selected/.test(sections), "sections.css трогает дни");
});

// --- Тёмная тема ---

test("стрелка списка видна в тёмной теме", () => {
  assert.match(
    sections,
    /data-theme="dark"[\s\S]{0,300}field select/,
    "нет светлой стрелки для тёмной темы",
  );
  // Цвет в data-URI должен быть светлым, а не тёмным.
  const darkBlock = sections.match(/data-theme="dark"[\s\S]*?stroke='([^']+)'/);
  assert.ok(darkBlock, "блок тёмной темы не найден");
  assert.match(
    darkBlock[1],
    /%23f5f0e6/i,
    "в тёмной теме стрелка тёмная: " + darkBlock[1],
  );
});