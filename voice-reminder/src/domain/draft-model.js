// domain/draft-model.js — черновик напоминания и его вспомогательные функции.
//
// Вынесено из App.jsx: это чистые данные и форматирование, не связанные
// с React. Благодаря этому их можно покрыть тестами без рендера интерфейса.
import { COLORS } from "./groups.js";
import { pad } from "./calendar.js";

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
  // Слово даты, которое человек произнёс: «сегодня», «завтра»,
  // «послезавтра» или ничего. В бесплатной версии дату из него не берём,
  // но по нему сообщаем, что напоминание записано на сегодня.
  spokenDateWord: null,
});

/**
 * Пояснение к дате после сохранения.
 *
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

/** Сдвиг месяца на step: «2026-11», -1 → «2026-10». */
export function shiftMonth(m, step) {
  const [y, n] = m.split("-").map(Number),
    d = new Date(y, n - 1 + step, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
