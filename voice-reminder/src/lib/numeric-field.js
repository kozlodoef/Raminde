// lib/numeric-field.js — ввод чисел в поля настроек.
//
// Зачем отдельный модуль. Поле, значение которого сразу уходит в состояние,
// нельзя очистить: человек стирает «5», значение становится пустым, разбор
// даёт 0, проверка «больше нуля» не проходит — и состояние не меняется.
// React видит, что состояние прежнее, и возвращает в поле «5». Стереть
// цифру невозможно: поле выглядит сломанным.
//
// Решение простое: пока человек печатает, показываем ровно то, что он
// набрал (черновик строкой), а в настройки пишем только осмысленное число.
// По уходу из поля черновик сбрасывается: пустое поле возвращает прежнее
// значение, а не превращается в ноль.

/**
 * Разбирает то, что человек набрал прямо сейчас.
 *
 * @param {string} raw — содержимое поля
 * @param {{min?: number, max?: number}} [options]
 * @returns {{empty: boolean, invalid: boolean, value: number|null}}
 *   empty — поле пустое (промежуточное состояние, не ошибка);
 *   invalid — набрано что-то, но числом это не является или меньше предела;
 *   value — годное число для сохранения, иначе null.
 */
export function parseNumericInput(raw, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : 1;
  const max = Number.isFinite(options.max) ? options.max : Infinity;
  const text = String(raw ?? '').trim();
  if (!text) return { empty: true, invalid: false, value: null };
  // Запятая как разделитель: на русской клавиатуре её набирают чаще точки.
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max)
    return { empty: false, invalid: true, value: null };
  return { empty: false, invalid: false, value: n };
}

/**
 * Что показать в поле.
 *
 * Черновик имеет приоритет: пока человек печатает, поле показывает его
 * текст, даже пустой. Без черновика — сохранённое значение.
 */
export function numericFieldValue(draft, saved) {
  if (draft !== undefined && draft !== null) return draft;
  return Number.isFinite(saved) ? String(saved) : '';
}

/** Убрать черновик поля, вернув показ сохранённого значения. */
export function dropDraft(drafts, key) {
  if (!drafts || !(key in drafts)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}