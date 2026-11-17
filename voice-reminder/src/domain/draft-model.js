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
});

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
