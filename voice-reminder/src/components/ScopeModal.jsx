// components/ScopeModal.jsx — «только этот день» или «все дни».
//
// Напоминание может стоять на один день, а может занимать несколько дат.
// Действуя с карточкой одного дня, человек должен понимать, что именно
// изменится: иначе легко задеть всю серию, думая, что правишь один день.
//
// Окно показывается только когда выбор действительно есть. Если событие
// одно, спрашивать не о чем — действие выполняется сразу.
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
  return (
    // Креста закрытия нет намеренно: внизу есть «Отмена», и две кнопки,
    // делающие одно и то же, только путают. Заголовок остаётся.
    <Modal title={deleting ? "Удалить напоминание" : "Изменить время"}>
      {/* Вопроса «только этот день или все?» здесь больше нет: на него
          отвечают сами кнопки, и повторять его словами незачем. */}
      <p>
        «{text}»
        {wording ? ` ${wording}` : ""}.
      </p>
      <button className="primary full" disabled={busy} onClick={onOne}>
        {deleting ? "Удалить только " : "Изменить время на "}
        {dateLabel}
      </button>
      <button className="secondary full" disabled={busy} onClick={onAll}>
        {deleting ? "Удалить все даты" : "Изменить время везде"}
      </button>
      <button className="text-button full" disabled={busy} onClick={onBack}>
        Отмена
      </button>
    </Modal>
  );
}
