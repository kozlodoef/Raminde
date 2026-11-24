// lib/swipe-math.js — расчёт положения ползунка «Удалить все!».
//
// Вынесено из компонента, чтобы проверять арифметику тестами: ошибку в
// направлении смещения легко не заметить глазами, а ползунок просто не
// двигается, и причина неочевидна.

/**
 * На сколько сдвинулся ползунок.
 *
 * Смещение считается вправо от точки нажатия: палец пошёл вправо — ползунок
 * поехал вправо. Ограничиваем диапазоном от 0 до max, чтобы ползунок не
 * уезжал за пределы дорожки и не уходил в минус.
 */
export function swipeOffset({ startX, currentX, max }) {
  const limit = Math.max(0, Number(max) || 0);
  const raw = (Number(currentX) || 0) - (Number(startX) || 0);
  return Math.min(limit, Math.max(0, raw));
}

/** Считается ли жест завершённым. */
export function swipeArmed(offset, max, threshold = 0.85) {
  const limit = Math.max(0, Number(max) || 0);
  if (!limit) return false;
  return (Number(offset) || 0) >= limit * threshold;
}

/** Дорожка, доступная ползунку: ширина трека минус сам ползунок и отступы. */
export function swipeMaxOffset(trackWidth, knobWidth, padding = 8) {
  return Math.max(1, (Number(trackWidth) || 0) - (Number(knobWidth) || 48) - padding);
}
