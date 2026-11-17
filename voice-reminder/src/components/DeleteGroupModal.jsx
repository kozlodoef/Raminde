// components/DeleteGroupModal.jsx — подтверждение удаления всей группы.
//
// Удаление необратимо отменяет все будущие срабатывания, поэтому вынесено
// в отдельное подтверждение: случайное нажатие в карточке группы не должно
// стирать правило.
import React from "react";
import Modal from "./Modal.jsx";

export default function DeleteGroupModal({ rule, onConfirm, onBack }) {
  return (
    <Modal title="Удалить всю группу?" onClose={onBack}>
      <p>Будут отменены все будущие срабатывания «{rule.text}».</p>
      <button className="primary full" onClick={onConfirm}>
        Удалить
      </button>
    </Modal>
  );
}
