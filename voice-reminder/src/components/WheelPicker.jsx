// components/WheelPicker.jsx — прокрутка часов и минут, как на iPhone.
//
// Почему своя прокрутка, а не <input type="time">. Системное поле выглядит
// по-разному на разных Android и часто открывает отдельный диалог — человек
// уходит с экрана событий и теряет контекст. Здесь всё остаётся на месте:
// два колеса, лёгкая инерция, щелчок на каждой остановке.
//
// Устройство колеса: список чисел прокручивается, ближайшее к центру
// считается выбранным. После остановки колесо доводится до ровного шага —
// без этого остаются «половинчатые» позиции и число выглядит смазанным.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { playUiSound } from "../lib/ui-sounds.js";

const ITEM_HEIGHT = 44;
const VISIBLE = 5; // сколько чисел видно; в центре — выбранное
const PADDING = Math.floor(VISIBLE / 2) * ITEM_HEIGHT;

/** Колесо одного числа: часы или минуты. */
function Wheel({ values, value, onChange, label, soundEnabled }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, startY: 0, startOffset: 0, last: 0 });
  const lastTick = useRef(0);

  // Положение выбранного числа: смещение вверх на его индекс.
  const offsetFor = useCallback(
    (v) => {
      const i = Math.max(0, values.indexOf(v));
      return -i * ITEM_HEIGHT;
    },
    [values],
  );

  useEffect(() => {
    if (!drag.current.active) setOffset(offsetFor(value));
  }, [value, offsetFor]);

  const settle = useCallback(
    (raw) => {
      const maxUp = 0;
      const maxDown = -(values.length - 1) * ITEM_HEIGHT;
      const clamped = Math.min(maxUp, Math.max(maxDown, raw));
      const index = Math.round(-clamped / ITEM_HEIGHT);
      const safe = Math.min(values.length - 1, Math.max(0, index));
      setOffset(-safe * ITEM_HEIGHT);
      if (values[safe] !== value) {
        onChange(values[safe]);
        playUiSound("tick", { enabled: soundEnabled });
      }
    },
    [values, value, onChange, soundEnabled],
  );

  const onDown = (e) => {
    drag.current = {
      active: true,
      startY: e.clientY,
      startOffset: offset,
      last: e.clientY,
    };
    setDragging(true);
    // Захват указателя не обязателен и на некоторых WebView бросает
    // исключение, обрывая обработчик. Отсутствие захвата не мешает: события
    // слушаются на всём окне.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* без захвата тоже работает */
    }
  };

  const onMove = (e) => {
    if (!drag.current.active) return;
    const raw = drag.current.startOffset + (e.clientY - drag.current.startY);
    const maxUp = 0;
    const maxDown = -(values.length - 1) * ITEM_HEIGHT;
    setOffset(Math.min(maxUp, Math.max(maxDown, raw)));
    // Щелчок на каждом пройденном числе: без него колесо «немое».
    const step = Math.round((e.clientY - drag.current.startY) / ITEM_HEIGHT);
    if (step !== lastTick.current) {
      lastTick.current = step;
      playUiSound("tick", { enabled: soundEnabled });
    }
  };

  const onUp = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    lastTick.current = 0;
    setDragging(false);
    settle(offset);
  };

  // Движение слушаем на окне, а не на колесе. Иначе при быстрой прокрутке
  // палец выходит за пределы колеса, и оно «замирает» на полпути.
  useEffect(() => {
    if (!dragging) return;
    const move = (e) => onMove(e);
    const up = () => onUp();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, offset]);

  return (
    <div className="wheel" role="listbox" aria-label={label}>
      <div
        className="wheel-scroll"
        style={{
          transform: `translateY(${offset}px)`,
          paddingTop: PADDING,
          paddingBottom: PADDING,
        }}
        onPointerDown={onDown}
      >
        {values.map((v) => (
          <div
            key={v}
            className="wheel-item"
            role="option"
            aria-selected={v === value}
            data-active={v === value ? "true" : undefined}
          >
            {String(v).padStart(2, "0")}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WheelPicker({ value, onChange, onDone, onCancel, soundEnabled = true }) {
  const [h, m] = (value || "00:00").split(":").map((v) => Number(v) || 0);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="wheel-picker">
      <div className="wheel-frame" style={{ height: VISIBLE * ITEM_HEIGHT }}>
        <span className="wheel-marker" aria-hidden="true" />
        <Wheel
          values={hours}
          value={h}
          label="Часы"
          soundEnabled={soundEnabled}
          onChange={(v) =>
            onChange(`${String(v).padStart(2, "0")}:${String(m).padStart(2, "0")}`)
          }
        />
        <span className="wheel-colon" aria-hidden="true">
          :
        </span>
        <Wheel
          values={minutes}
          value={m}
          label="Минуты"
          soundEnabled={soundEnabled}
          onChange={(v) =>
            onChange(`${String(h).padStart(2, "0")}:${String(v).padStart(2, "0")}`)
          }
        />
      </div>
      <div className="wheel-actions">
        <button className="wheel-done" onClick={onDone}>
          Готово
        </button>
        <button className="wheel-cancel" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export { ITEM_HEIGHT, VISIBLE, PADDING };
