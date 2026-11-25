import test from "node:test";
import assert from "node:assert/strict";

import { watchViewportHeight } from "../src/lib/viewport-height.js";

// Проверяем поведение без настоящего браузера: подменяем document и
// visualViewport минимальными заглушками. Задача — убедиться, что высота
// приложения следует за видимой областью, а не за окном.

function makeEnv({ windowHeight = 800, viewportHeight = 800 } = {}) {
  const props = new Map();
  const dataset = {};
  const listeners = new Map();
  const root = {
    style: {
      setProperty(name, value) {
        props.set(name, value);
      },
    },
    dataset,
  };
  const viewport = {
    height: viewportHeight,
    addEventListener(name, handler) {
      listeners.set("viewport:" + name, handler);
    },
    removeEventListener(name) {
      listeners.delete("viewport:" + name);
    },
  };
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    visualViewport: globalThis.visualViewport,
  };
  const win = {
    innerHeight: windowHeight,
    addEventListener(name, handler) {
      listeners.set("window:" + name, handler);
    },
    removeEventListener(name) {
      listeners.delete("window:" + name);
    },
  };
  globalThis.document = { documentElement: root };
  globalThis.window = win;
  globalThis.visualViewport = viewport;
  return {
    props,
    dataset,
    viewport,
    win,
    listeners,
    setHeights(newWindow, newViewport) {
      win.innerHeight = newWindow;
      viewport.height = newViewport;
    },
    restore() {
      globalThis.document = previous.document;
      globalThis.window = previous.window;
      globalThis.visualViewport = previous.visualViewport;
    },
  };
}

test("высота берётся по видимой области, а не по окну", () => {
  const env = makeEnv({ windowHeight: 800, viewportHeight: 800 });
  try {
    const stop = watchViewportHeight();
    assert.equal(env.props.get("--app-height"), "800px");
    stop();
  } finally {
    env.restore();
  }
});

test("при клавиатуре высота уменьшается и ставится признак", () => {
  const env = makeEnv({ windowHeight: 800, viewportHeight: 800 });
  try {
    const stop = watchViewportHeight();
    // Клавиатура на 300 px: окно прежнее, видимая область меньше.
    env.setHeights(800, 500);
    env.listeners.get("viewport:resize")?.();
    assert.equal(env.props.get("--app-height"), "500px");
    assert.equal(env.props.get("--keyboard-height"), "300px");
    assert.equal(env.dataset.keyboard, "open");
    stop();
  } finally {
    env.restore();
  }
});

test("после закрытия клавиатуры признак снимается", () => {
  const env = makeEnv({ windowHeight: 800, viewportHeight: 800 });
  try {
    const stop = watchViewportHeight();
    env.setHeights(800, 500);
    env.listeners.get("viewport:resize")?.();
    assert.equal(env.dataset.keyboard, "open");
    env.setHeights(800, 800);
    env.listeners.get("viewport:resize")?.();
    assert.equal(env.dataset.keyboard, undefined);
    assert.equal(env.props.get("--keyboard-height"), "0px");
    stop();
  } finally {
    env.restore();
  }
});

test("без visualViewport используется высота окна", () => {
  const env = makeEnv({ windowHeight: 640, viewportHeight: 640 });
  try {
    const saved = globalThis.visualViewport;
    globalThis.visualViewport = undefined;
    const stop = watchViewportHeight();
    assert.equal(env.props.get("--app-height"), "640px");
    stop();
    globalThis.visualViewport = saved;
  } finally {
    env.restore();
  }
});

test("отписка снимает обработчики", () => {
  const env = makeEnv();
  try {
    const stop = watchViewportHeight();
    assert.ok(env.listeners.size > 0, "обработчики должны быть поставлены");
    stop();
    assert.equal(env.listeners.size, 0);
  } finally {
    env.restore();
  }
});

test("без document вызов безопасен", () => {
  const env = makeEnv();
  try {
    globalThis.document = undefined;
    const stop = watchViewportHeight();
    assert.equal(typeof stop, "function");
    stop();
  } finally {
    env.restore();
  }
});
