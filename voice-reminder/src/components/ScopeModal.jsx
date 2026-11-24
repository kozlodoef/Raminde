// components/ScopeModal.jsx — «только это событие» или «все».
//
// Напоминание может стоять на один день, а может повторяться или занимать
// несколько дат. Удаляя карточку одного дня, человек должен понимать, что
// именно исчезнет: иначе легко стереть всю серию, думая, что убрал один день.
//
// Окно показывается только когда выбор действительно есть. Если событие
// одно, спрашивать не о чем — удаляем сразу.
import React from "react";
import Modal from "./Modal.jsx";

export default function ScopeModal({
  action = "delete",
  text,
  dateLabel,
  wording,
  onOne,
  onAll,
  onBack,
  busy,
}) {
  const deleting = action === "delete";
  const title = deleting ? "Удалить напоминание" : "Изменить время";
  return (
    <Modal title={title} onClose={onBack}>
      <p>
        «{text}» {wording}.
      </p>
      <p className="hint">
        {deleting ? "Убрать" : "Изменить"} только {dateLabel} или все даты сразу?
      </p>
      <button className="primary full" disabled={busy} onClick={onOne}>
        {deleting ? "Удалить только " : "Изменить только "}
        {dateLabel}
      </button>
      <button className="secondary full" disabled={busy} onClick={onAll}>
        {deleting ? "Удалить все даты" : "Изменить все даты"}
      </button>
      <button className="text-button full" disabled={busy} onClick={onBack}>
        Отмена
      </button>
    </Modal>
  );
}
