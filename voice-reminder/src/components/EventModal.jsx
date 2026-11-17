// components/EventModal.jsx — карточка группы напоминаний.
//
// Здесь собраны действия над всей группой: изменить, пропустить одно
// срабатывание, приостановить и удалить. Важно: «Пропустить» убирает только
// текущее срабатывание и не трогает остальные, а «Приостановить» выключает
// группу до явного включения.
import React from "react";
import Modal from "./Modal.jsx";
import { describe } from "../domain/calendar.js";
import { dateLabel } from "../domain/draft-model.js";

export default function EventModal({
  rule,
  event,
  busy,
  voiceActive,
  onEdit,
  onSkip,
  onToggle,
  onDelete,
  onClose,
}) {
  return (
    <Modal title={rule.text} onClose={onClose}>
      <p>{describe(rule.schedule)}</p>
      {event && (
        <p className="hint">
          Выбрано: {dateLabel(event.date)} · {event.time}
        </p>
      )}
      <button
        className="primary full"
        disabled={voiceActive || busy}
        onClick={onEdit}
      >
        Изменить группу
      </button>
      {event && event.at > Date.now() && (
        <button className="secondary full" onClick={onSkip}>
          Пропустить это срабатывание
        </button>
      )}
      <button className="secondary full" onClick={onToggle}>
        {rule.enabled ? "Приостановить группу" : "Включить группу"}
      </button>
      <button className="text-button full danger" onClick={onDelete}>
        Удалить группу
      </button>
    </Modal>
  );
}
