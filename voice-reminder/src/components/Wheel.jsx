// components/Wheel.jsx — «колесо» выбора числа прокруткой.
//
// Прокрутка обрабатывается с задержкой 100 мс: без неё onChange срабатывал бы
// на каждый пиксель движения и перерисовывал весь экран.
import React, { useEffect, useRef } from "react";
import { pad } from "../domain/calendar.js";

export default function Wheel({ label, value, values, onChange }) {
  const ref = useRef(),
    timer = useRef();
  useEffect(() => {
    const selected = values.indexOf(value);
    if (ref.current && selected >= 0) ref.current.scrollTop = selected * 48;
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="wheel-column">
      <span className="wheel-label">{label}</span>
      <div
        className="wheel"
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(e) => {
          const i = values.indexOf(value);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(
              values[
                Math.max(
                  0,
                  Math.min(
                    values.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                )
              ],
            );
          }
        }}
        onScroll={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const i = Math.round(ref.current.scrollTop / 48);
            if (values[i] !== undefined && values[i] !== value)
              onChange(values[i]);
          }, 100);
        }}
      >
        <div className="wheel-space" />
        {values.map((v) => (
          <button
            key={v}
            role="option"
            aria-selected={v === value}
            className={v === value ? "chosen" : ""}
            onClick={() => onChange(v)}
          >
            {pad(v)}
          </button>
        ))}
        <div className="wheel-space" />
      </div>
    </div>
  );
}
