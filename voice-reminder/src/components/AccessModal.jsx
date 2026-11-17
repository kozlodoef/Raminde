// components/AccessModal.jsx — пробный период, оплата и восстановление доступа.
//
// Окно сознательно работает без эквайринга, если он не настроен: вместо
// кнопок оплаты показывается честное сообщение о тестовой сборке. Так
// пользователь не упирается в неработающую кнопку.
import React from "react";
import Modal from "./Modal.jsx";

export default function AccessModal({
  billingConfigured,
  bill,
  email,
  onEmail,
  keyValue,
  onKey,
  onCheckout,
  onCheckStatus,
  onRecoveryKey,
  onRestore,
  onClose,
}) {
  return (
    <Modal title="Первый месяц — бесплатно" onClose={onClose}>
      <p>
        Все функции и любое количество напоминаний в течение месяца с
        первого запуска. Затем — месячная или годовая подписка.
      </p>
      <p className="hint">
        Сохранённые напоминания не отключаются. Автоматических списаний нет.
      </p>
      {!billingConfigured || !bill?.configured ? (
        <p className="notice">
          В этой тестовой сборке эквайринг ещё не настроен. Настоящая оплата
          недоступна.
        </p>
      ) : (
        <>
          <label className="field">
            Email для чека
            <input
              type="email"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
            />
          </label>
          {["monthly", "yearly"].map((plan) => (
            <button
              className="primary full"
              key={plan}
              onClick={() => onCheckout(plan, email)}
            >
              {plan === "monthly" ? "Месяц" : "Год"} · {bill.prices[plan]} ₽
            </button>
          ))}
          <button className="secondary full" onClick={onCheckStatus}>
            Проверить оплату
          </button>
        </>
      )}
      {billingConfigured && (
        <>
          <button className="text-button full" onClick={onRecoveryKey}>
            Показать ключ восстановления
          </button>
          <label className="field">
            Ключ доступа
            <input
              value={keyValue || ""}
              onChange={(e) => onKey(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="secondary full" onClick={() => onRestore(keyValue)}>
            Восстановить доступ
          </button>
        </>
      )}
    </Modal>
  );
}
