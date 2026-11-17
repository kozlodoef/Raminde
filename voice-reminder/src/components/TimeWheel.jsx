// components/TimeWheel.jsx — выбор часов и минут двумя колесами.
import React from "react";
import Wheel from "./Wheel.jsx";
import { pad } from "../domain/calendar.js";

export default function TimeWheel({ value, onChange, language = "ru" }) {
  const [h, m] = (value || "09:00").split(":").map(Number);
  return (
    <div className="time-picker">
      <Wheel
        label={language === "en" ? "Hours" : "Часы"}
        value={h}
        values={Array.from({ length: 24 }, (_, i) => i)}
        onChange={(v) => onChange(pad(v) + ":" + pad(m))}
      />
      <span>:</span>
      <Wheel
        label={language === "en" ? "Minutes" : "Минуты"}
        value={m}
        values={Array.from({ length: 60 }, (_, i) => i)}
        onChange={(v) => onChange(pad(h) + ":" + pad(v))}
      />
    </div>
  );
}
