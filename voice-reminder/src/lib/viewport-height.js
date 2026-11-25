// lib/viewport-height.js — высота приложения по видимой области.
//
// Зачем это нужно.
//
// На телефоне при открытии клавиатуры окно (window.innerHeight и 100dvh) не
// меняется, а видимая область (visualViewport.height) уменьшается на высоту
// клавиатуры. Если экран задан как height: 100dvh с запретом прокрутки,
// нижняя часть содержимого — у нас это календарь — оказывается под
// клавиатурой и достать её нельзя: страница не прокручивается, потому что
// по мнению браузера всё содержимое уже помещается в окно.
//
// Поэтому высоту задаём сами и обновляем по visualViewport: в CSS это
// переменная --app-height. Тогда при клавиатуре экран становится ниже,
// содержимое перестаёт помещаться — и появляется прокрутка, которой раньше
// не было.

/**
 * Публикует высоту видимой области в --app-height и следит за изменениями.
 *
 * @param {Document} [doc]
 * @returns {() => void} отписка (нужна для тестов и горячей перезагрузки)
 */
export function watchViewportHeight(doc = globalThis.document) {
  if (!doc) return () => {};
  const root = doc.documentElement;
  if (!root) return () => {};

  const viewport =
    globalThis.visualViewport ||
    (globalThis.window && globalThis.window.visualViewport) ||
    null;

  const apply = () => {
    // Берём видимую область, если браузер её даёт, иначе обычную высоту окна.
    const height = viewport?.height || globalThis.window?.innerHeight || 0;
    if (height > 0) root.style.setProperty("--app-height", Math.round(height) + "px");
    // Клавиатура открыта, когда видимая область заметно ниже окна.
    const windowHeight = globalThis.window?.innerHeight || 0;
    const keyboard = viewport && windowHeight
      ? Math.max(0, Math.round(windowHeight - viewport.height))
      : 0;
    root.style.setProperty("--keyboard-height", keyboard + "px");
    if (keyboard > 120) root.dataset.keyboard = "open";
    else delete root.dataset.keyboard;
  };

  apply();

  const events = [];
  const on = (target, name, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler, { passive: true });
    events.push([target, name, handler]);
  };

  if (viewport) {
    on(viewport, "resize", apply);
    // При прокрутке клавиатуры видимая область тоже смещается.
    on(viewport, "scroll", apply);
  }
  const win = globalThis.window;
  on(win, "resize", apply);
  on(win, "orientationchange", apply);

  return () => {
    for (const [target, name, handler] of events)
      target.removeEventListener(name, handler);
  };
}
