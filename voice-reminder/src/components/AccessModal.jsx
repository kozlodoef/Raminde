// components/AccessModal.jsx — подписка и восстановление доступа.
//
// Окно сознательно работает без эквайринга, если он не настроен: вместо
// кнопок оплаты показывается честное сообщение о тестовой сборке. Так
// пользователь не упирается в неработающую кнопку.
//
// Главное отличие от прежней версии: здесь больше нет «пробный месяц
// закончился, поэтому работать нельзя». Подписка не открывает приложение —
// она снимает дневной предел в три напоминания. Об этом и написано.
import React from "react";
import Modal from "./Modal.jsx";
import { FREE_REMINDERS_PER_DAY } from "../domain/access.js";

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
  const premium = !!bill?.premium;
  return (
    <Modal title="Подписка" onClose={onClose}>
      <p>
        Без подписки можно ставить до {FREE_REMINDERS_PER_DAY} напоминаний в
        день. С подпиской предел снимается — остаётся только технический
        максимум 24, по числу часов в сутках.
      </p>
      <p className="hint">
        {premium
          ? "Подписка активна. Предел на день снят."
          : "Сохранённые напоминания не отключаются и продолжают звучать при любом состоянии подписки."}
      </p>
      {!billingConfigured || !bill?.configured ? (
        <p className="notice">
          В этой сборке эквайринг ещё не настроен. Настоящая оплата
          недоступна.
        </p>
      ) : (
        <>
          <p className="hint">
            {bill.prices?.monthly && bill.prices?.yearly
              ? `Месяц — ${bill.prices.monthly} ₽, год — ${bill.prices.yearly} ₽.`
              : ""}{" "}
            Списание — раз в месяц или раз в год, начиная с дня оплаты.
            Отменить можно в любой момент: подписка действует до конца
            оплаченного периода.
          </p>
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