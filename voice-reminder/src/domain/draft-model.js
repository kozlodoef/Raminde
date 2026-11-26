// domain/draft-model.js — черновик напоминания и его вспомогательные функции.
//
// Вынесено из App.jsx: это чистые данные и форматирование, не связанные
// с React. Благодаря этому их можно покрыть тестами без рендера интерфейса.
import { COLORS } from "./groups.js";
import { pad } from "./calendar.js";
import { editorPhrase } from "./home-editor.js";

export const uid = () => crypto.randomUUID();

/** «1 событие», «2 события», «5 событий» — русские формы множественного числа. */
export const eventCount = (n) =>
  `${n} ${new Intl.PluralRules("ru").select(n) === "one" ? "событие" : new Intl.PluralRules("ru").select(n) === "few" ? "события" : "событий"}`;

/** Пустой черновик правила. Цвет берётся по кругу, чтобы группы различались. */
export const blank = (index = 0) => ({
  id: uid(),
  text: "",
  phrase: "",
  selectedDates: [],
  dates: [],
  times: [],
  color: COLORS[index % COLORS.length],
  issues: [],
  // Сомнения разбора: неоднозначный час («в час»), несколько дат во фразе.
  // По ним показывается переспрос перед сохранением — не ошибка, поэтому
  // отдельно от issues.
  doubts: [],
  // Слово даты, которое человек произнёс: «сегодня», «завтра»,
  // «послезавтра» или ничего. В бесплатной версии дату из него не берём,
  // но по нему сообщаем, что напоминание записано на сегодня.
  spokenDateWord: null,
});

/**
 * Пояснение к дате после сохранения. *
 * В бесплатной версии дата берётся только с календаря. Если человек её не
 * отметил, напоминание встаёт на сегодня — и об этом надо сказать, иначе
 * сказанное «завтра» останется у него в голове, а сработает сегодня.
 */
export function dateNote(draft) {
  const chosen = draft?.selectedDates || draft?.dates || [];
  if (chosen.length) return "";
  const word = draft?.spokenDateWord;
  if (word === "tomorrow" || word === "afterTomorrow")
    return "Дата не выбрана, напоминание записано на сегодня. Чтобы перенести на другой день, отметьте его в календаре.";
  return "Напоминание записано на сегодня.";
}

/**
 * Черновик, сохранённый в прошлый раз.
 * localStorage может содержать мусор (например, после ручной правки или
 * старой версии) — тогда возвращаем пустой объект, а не падаем.
 */
export function cachedDrafts() {
  try {
    return JSON.parse(localStorage.getItem("raminde.drafts.v3") || "{}");
  } catch {
    return {};
  }
}

/** «7 ноября» из строки вида 2026-11-07. */
export const dateLabel = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(d + "T12:00:00"),
  );

/**
 * Нужно ли переспросить о двусмысленном разборе перед сохранением.
 *
 * Вынесено из App.jsx: это решение о данных, а не о разметке, и его нужно
 * проверять тестом. Ошибка здесь дорогая в обе стороны — лишний вопрос
 * раздражает на каждой обычной фразе, а пропущенный сохраняет напоминание
 * не на то время.
 *
 * Спрашиваем о часе, когда есть из чего выбрать: «в час» — 13:00 или 01:00,
 * «полчетвёртого» — 15:30 или 03:30. Ошибка стоит полсуток, поэтому вопрос
 * уместен.
 *
 * О нескольких датах — только когда дата уже известна: иначе человек сначала
 * выбирает время, и вопрос о датах был бы преждевременным.
 */
export function wantsTimeConfirm(current) {
  const doubts = current?.doubts || [];
  if (doubts.some((d) => d.kind === "hour")) return true;
  return (
    doubts.some((d) => d.kind === "dates") &&
    Boolean(current?.dates?.length || current?.selectedDates?.length)
  );
}

/**
 * Переносит разбор на другое чтение часа.
 *
 * Нужно для переспроса «13:00 или 01:00?»: показываем оба варианта, и выбор
 * человека должен попасть и в расписание, и в текст в поле ввода. Иначе
 * напоминание сработало бы по одному времени, а человек видел бы другое.
 *
 * В поле ввода время уже показано цифрами (в этом и смысл подсказки), поэтому
 * заменяем прежнее «13:00» на выбранное — по исходной фразе («в час позвонить»)
 * такую замену сделать нельзя: выбранного времени в ней ещё нет.
 *
 * @param {object} draft — текущий черновик
 * @param {string} clock — выбранное время «ЧЧ:ММ»
 * @param {string} [previous] — прежнее время, которое заменяем
 * @param {Date} [now] — для сборки текста поля
 */
export function applyHourChoice(draft, clock, previous, now = new Date()) {
  if (!draft || !clock) return draft;
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return draft;
  const old = previous || draft.doubts?.find((d) => d.kind === "hour")?.chosen;
  const next = { ...draft };

  // Время в расписании.
  if (draft.schedule?.kind === "once" && draft.schedule.at) {
    const at = new Date(draft.schedule.at);
    at.setHours(h, m, 0, 0);
    next.schedule = { ...draft.schedule, at: at.toISOString() };
  }
  const times = draft.times?.length ? draft.times : draft.schedule?.times;
  if (times?.length) {
    const patched = times.map((t) => (t === old ? clock : t));
    next.times = patched;
    if (next.schedule) next.schedule = { ...next.schedule, times: patched };
  }

  // Текст в поле ввода: «в 13:00 позвонить» → «в 01:00 позвонить».
  if (old) {
    const shown = editorPhrase(draft, now);
    const patched = shown.replace(old, clock);
    if (patched !== shown) next.phrase = patched;
  }
  return next;
}


/** Сдвиг месяца на step: «2026-11», -1 → «2026-10». */
export function shiftMonth(m, step) {
  const [y, n] = m.split("-").map(Number),
    d = new Date(y, n - 1 + step, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
