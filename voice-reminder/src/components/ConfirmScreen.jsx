import React, { useMemo, useState } from 'react';
import { parseReminder, formatWhen } from '../lib/timeParser.js';

function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ConfirmScreen — показывает расшифровку голосового сообщения и то, что "понял" ИИ.
 * Кнопки: «Готово» (сохранить) и «Изменить» (править текст/время вручную).
 */
export default function ConfirmScreen({ phrase, onDone, onCancel, onSave }) {
  const parsed = useMemo(() => parseReminder(phrase), [phrase]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(parsed.text);
  const [when, setWhen] = useState(parsed.when);
  const [whenStr, setWhenStr] = useState(toLocalInputValue(parsed.when));

  const timeOk = parsed.timeFound && !parsed.approx;

  const save = (t, w) => {
    onSave({ text: t.trim() || 'Напоминание', when: w });
  };

  if (!editing) {
    return (
      <div className="card">
        <div className="section-title" style={{ margin: '0 4px 8px' }}>Ваше сообщение</div>
        <div className="transcript">«{phrase}»</div>

        <div className="section-title" style={{ margin: '0 4px 8px' }}>Я поняла так</div>
        <div className="transcript" style={{ borderStyle: 'solid' }}>
          ⏰ {formatWhen(parsed.when)} — «{parsed.text}»
        </div>

        <div className="parsed">
          <span className={'chip ' + (timeOk ? 'ok' : 'warn')}>
            {timeOk ? '✓ Время распознано' : parsed.approx ? '≈ Время определено приблизительно' : '? Время не указано'}
          </span>
          {parsed.dateFound && <span className="chip ok">Дата учтена</span>}
          {!parsed.dateFound && !parsed.approx && <span className="chip">Ближайшее подходящее время</span>}
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          Если расшифровка правильная — нажмите «Готово». Если что-то не так — «Изменить».
        </div>

        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => save(parsed.text, parsed.when)}>✔ Готово</button>
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>✎ Изменить</button>
        </div>
        <div style={{ height: 10 }} />
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
        </div>
      </div>
    );
  }

  // Режим ручного редактирования
  return (
    <div className="card edit-area">
      <div className="section-title" style={{ margin: '0 4px 8px' }}>Изменить</div>
      <label>Что напомнить</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus />
      <label>Когда</label>
      <input
        type="datetime-local"
        value={whenStr}
        onChange={(e) => {
          setWhenStr(e.target.value);
          const d = new Date(e.target.value);
          if (!isNaN(d)) setWhen(d);
        }}
      />
      <div style={{ height: 16 }} />
      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={!when}
          onClick={() => save(text, when)}
        >✔ Сохранить</button>
        <button className="btn btn-secondary" onClick={() => setEditing(false)}>← Назад</button>
      </div>
      <div style={{ height: 10 }} />
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
