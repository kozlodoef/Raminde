// components/DateConflictBubble.jsx — выбор между датами из текста и календаря.
//
// Конфликт возникает, когда пользователь назвал дату голосом и одновременно
// выбрал другую на календаре. Молча выбрать одну нельзя: напоминание уйдёт
// не в тот день, поэтому решение остаётся за пользователем.
import React from "react";

export default function DateConflictBubble({ onPickCalendar, onPickText }) {
  return (
    <div className="floating-bubble conflict-bubble" role="alert">
      <p>В тексте и календаре разные даты. Какие использовать?</p>
      <button className="secondary" onClick={onPickCalendar}>
        Даты календаря
      </button>
      <button className="primary" onClick={onPickText}>
        Даты из текста
      </button>
    </div>
  );
}
