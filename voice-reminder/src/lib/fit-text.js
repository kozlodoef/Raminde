// lib/fit-text.js — подбор размера шрифта, чтобы текст помещался в поле целиком.
//
// Зачем. Поле ввода напоминания показывает фразу целиком: дату, время и сам
// текст. Фразы бывают длинные («напомни двадцать пятого декабря в 19:30
// купить подарки детям на Новый год»), и при фиксированном размере шрифта
// хвост уезжал за границу поля — приходилось прокручивать, чтобы прочитать
// то, что только что сказал. Это неудобно: главное преимущество поля в том,
// что фразу видно сразу и целиком.
//
// Решение: шрифт подбирается под длину текста. Короткая фраза показывается
// крупно (её легко прочитать на ходу), длинная — мельче, но вся целиком.
// Ниже минимального размера не опускаемся: читаемость важнее, чем
// «поместилось любой ценой».
//
// Функция чистая и не зависит от DOM — её можно проверить тестами.

/** Размеры шрифта в порядке убывания: первый подходящий и берём. */
export const FONT_STEPS = [26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13];

/** Ниже этого размера текст на телефоне уже тяжело читать. */
export const MIN_FONT = 13;

/**
 * Оценивает, сколько места займёт текст при заданном размере шрифта.
 *
 * Ширина символа зависит от шрифта, поэтому берём усреднённые коэффициенты
 * для кириллицы: строчные уже, заглавные и цифры шире. Точность здесь не
 * нужна — важно не ошибиться на строку-другую.
 *
 * @param {string} text
 * @param {number} fontSize — размер в пикселях
 * @param {number} width — ширина поля в пикселях
 * @param {number} height — высота поля в пикселях
 * @returns {{lines: number, needed: number, fits: boolean}}
 */
export function measureText(text, fontSize, width, height) {
  if (!text) return { lines: 0, needed: 0, fits: true };
  if (!width || !height || !fontSize) return { lines: 0, needed: 0, fits: true };

  // Средняя ширина символа относительно размера шрифта. Для Manrope с
  // кириллицей это около 0.52; цифры и заглавные шире.
  const charWidth = fontSize * 0.52;
  // Межстрочный интервал: в стилях поля он равен 1.5.
  const lineHeight = fontSize * 1.5;

  const perLine = Math.max(1, Math.floor(width / charWidth));
  // Разбиваем по словам, чтобы не «ломать» слова посередине —
  // браузер переносит так же.
  const words = String(text).split(/\s+/).filter(Boolean);
  let lines = 1;
  let current = 0;
  for (const word of words) {
    const len = word.length + (current > 0 ? 1 : 0);
    if (current + len > perLine && current > 0) {
      lines += 1;
      current = word.length;
    } else {
      current += len;
    }
    // Слово длиннее строки всё равно займёт несколько строк.
    while (current > perLine) {
      lines += 1;
      current -= perLine;
    }
  }

  const needed = lines * lineHeight;
  return { lines, needed, fits: needed <= height };
}

/**
 * Подбирает размер шрифта, при котором текст помещается в поле целиком.
 *
 * Возвращает первый (самый крупный) размер из FONT_STEPS, при котором текст
 * помещается. Если не помещается даже минимальный — возвращает MIN_FONT:
 * лучше мелкий текст с прокруткой, чем нечитаемый.
 *
 * @param {string} text
 * @param {{width: number, height: number}} box
 * @param {number[]} steps
 * @returns {number}
 */
export function fitFontSize(text, box, steps = FONT_STEPS) {
  if (!text) return steps[0] ?? FONT_STEPS[0];
  if (!box || !box.width || !box.height) return steps[0] ?? FONT_STEPS[0];

  for (const size of steps) {
    if (measureText(text, size, box.width, box.height).fits) return size;
  }
  return MIN_FONT;
}