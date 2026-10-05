import React from 'react';
import { formatWhen } from '../lib/timeParser.js';

export default function ReminderList({ items, onDelete }) {
  const active = items.filter((r) => !r.done).sort((a, b) => new Date(a.when) - new Date(b.when));
  if (active.length === 0) {
    return <div className="empty">Пока нет активных напоминаний.<br />Нажмите 🎙️ и скажите, о чём напомнить.</div>;
  }
  return (
    <div className="rem-list">
      {active.map((r) => (
        <div className="rem-item" key={r.id}>
          <div className="txt">
            <div className="t">🔔 {r.text}</div>
            <div className="w">{formatWhen(new Date(r.when))}</div>
          </div>
          <button
            className="icon-btn"
            title="Удалить"
            onClick={() => onDelete(r.id)}
            aria-label="Удалить напоминание"
          >🗑</button>
        </div>
      ))}
    </div>
  );
}
