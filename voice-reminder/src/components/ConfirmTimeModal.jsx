// components/ConfirmTimeModal.jsx — переспрос о двусмысленном разборе.
//
// Зачем окно, а не тихая правка. Разбор формально удался, но значение может
// быть другим: «полчетвёртого» — это и 15:30, и 03:30; «в час» — и 13:00, и
// 01:00. Выбрать молча нельзя: человек будет уверен, что поставил напоминание
// на день, а оно сработает ночью. Поэтому показываем оба чтения и по умолчанию
// выделяем дневное — оно обычнее.
//
// Второй случай — несколько дат в одной фразе. Там выбора из двух вариантов
// нет: напоминание ставится на одну дату, и остальные человек разведёт по
// очереди кнопкой «Добавить».
import React from "react";
import Modal from "./Modal.jsx";
import { dateLabel } from "../domain/draft-model.js";

/** Как назвать вариант часа: «15:30 (днём)» / «03:30 (ночью)». */
function choiceLabel(clock, index) {
  return index === 0 ? `${clock} (днём)` : `${clock} (ночью)`;
}

export default function ConfirmTimeModal({
  doubts,
  date,
  picked,
  onPick,
  onConfirm,
  onEdit,
  onCancel,
}) {
  const hour = doubts.find((d) => d.kind === "hour") || null;
  const dates = doubts.find((d) => d.kind === "dates") || null;
  const day = date ? dateLabel(date) : "";
  const chosen = picked || hour?.chosen || "";

  return (
    <Modal
      title={hour ? "Уточните время" : "Уточните дату"}
      onClose={onCancel}
    >
      {hour && (
        <>
          <p>
            {day ? `${day}, ` : ""}
            {chosen}? Похоже на дневное время, но так говорят и про ночь.
          </p>
          <div className="doubt-choices" role="radiogroup" aria-label="Время">
            {hour.choices.map((clock, i) => (
              <button
                key={clock}
                type="button"
                role="radio"
                aria-checked={clock === chosen}
                className={
                  "secondary full" + (clock === chosen ? " is-chosen" : "")
                }
                onClick={() => onPick(clock)}
              >
                {choiceLabel(clock, i)}
              </button>
            ))}
          </div>
        </>
      )}
      {dates && (
        <p>
          В напоминании названо дат: {dates.count}. Сейчас будет использована
          одна
          {day ? ` — ${day}` : ""}. Остальные добавьте по очереди кнопкой
          «Добавить»: у одного напоминания одна дата.
        </p>
      )}
      <button className="primary full" onClick={onConfirm}>
        Да, сохранить
      </button>
      <button className="secondary full" onClick={onEdit}>
        Изменить
      </button>
      <button className="text-button full" onClick={onCancel}>
        Отмена
      </button>
    </Modal>
  );
}
