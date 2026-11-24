// components/SwipeToDelete.jsx — слайдер «Удалить все!».
//
// Почему слайдер, а не кнопка. Действие удаляет все напоминания выбранного
// дня и не отменяется. Обычную кнопку легко нажать случайно, поэтому нужен
// жест, который нельзя сделать по неосторожности: ползунок надо довести до
// конца. Если отпустить раньше, он плавно возвращается назад.
//
// Работает и мышью, и пальцем: pointer-события покрывают оба случая, а
// setPointerCapture не даёт ползунку «отклеиться» при быстром движении.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  swipeOffset,
  swipeArmed,
  swipeMaxOffset,
} from "../lib/swipe-math.js";

const THRESHOLD = 0.85;

export default function SwipeToDelete({
  label = "Удалить все!",
  onConfirm,
  disabled = false,
  busy = false,
}) {
  const trackRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const state = useRef({ startX: 0, max: 0, offset: 0 });

  const maxOffset = useCallback(() => {
    const el = trackRef.current;
    if (!el) return 0;
    const knob = el.querySelector(".swipe-knob");
    return swipeMaxOffset(el.clientWidth, knob?.clientWidth);
  }, []);

  const reset = useCallback(() => {
    setDragging(false);
    setArmed(false);
    setOffset(0);
    state.current.offset = 0;
    state.current.now = 0;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const max = state.current.max;
      // Направление и пределы считает чистая функция: её поведение
      // проверено тестом, а ошибку в знаке здесь легко не заметить.
      const value = swipeOffset({
        startX: state.current.startX,
        currentX: e.clientX,
        max,
      });
      state.current.now = value;
      setOffset(value);
      setArmed(swipeArmed(value, max, THRESHOLD));
    };
    const up = () => {
      const max = state.current.max;
      if (swipeArmed(state.current.now || 0, max, THRESHOLD)) {
        setOffset(max);
        // Небольшая задержка: ползунок успевает доехать до конца, и только
        // потом экран меняется. Без неё действие выглядит как рывок.
        setTimeout(() => {
          onConfirm?.();
          reset();
        }, 160);
      } else {
        reset();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, onConfirm, reset]);

  const start = (e) => {
    if (disabled || busy) return;
    state.current.max = maxOffset();
    state.current.startX = e.clientX;
    state.current.now = 0;
    setDragging(true);
  };

  return (
    <div
      ref={trackRef}
      className={
        "swipe-track" +
        (dragging ? " is-dragging" : "") +
        (armed ? " is-armed" : "") +
        (busy ? " is-busy" : "")
      }
    >
      <span className="swipe-hint" aria-hidden="true">
        {busy ? "Удаляю…" : label}
      </span>
      <button
        type="button"
        className="swipe-knob"
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={label}
        disabled={disabled || busy}
        onPointerDown={start}
      >
        ✕
      </button>
    </div>
  );
}
