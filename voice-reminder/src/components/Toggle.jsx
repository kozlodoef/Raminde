// components/Toggle.jsx — переключатель настройки с подписью.
import React from "react";

export default function Toggle({ label, value, onChange, description }) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        className="toggle"
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
