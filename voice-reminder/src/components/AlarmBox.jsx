// components/AlarmBox.jsx — экран сработавшего напоминания.
//
// Две ветки поведения:
//  • браузер — сигнал, уведомление и озвучку запускает сам экран (таймерами);
//  • Android — всё это делает нативный DeliveryService, поэтому здесь стоит
//    ранний выход, иначе звук и голос сработали бы дважды.
//
// Подтверждение относится только к текущему срабатыванию: серия напоминаний
// продолжает жить, поэтому нельзя закрывать её целиком.
import React, { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { isNative } from "../lib/native.js";
import { startRecognition } from "../lib/speech.js";
import { speak, cancelSpeech, playAlarm, stopAlarm, sendPush } from "../lib/alerts.js";

export default function AlarmBox({ event, settings, onAck, onSnooze }) {
  const [hearing, setHearing] = useState(false),
    [error, setError] = useState(""),
    rec = useRef();
  useEffect(() => {
    if (isNative()) return;
    let n = 0;
    const alert = () => {
      n++;
      if (settings.sound) playAlarm(false);
      if (settings.mode !== "voice")
        sendPush(
          "Remind me",
          settings.privateNotification ? "Новое напоминание" : event.text,
        );
      if (settings.mode !== "notification")
        speak((settings.name ? settings.name + "! " : "") + event.text);
    };
    alert();
    const timer = settings.repeat
      ? setInterval(() => {
          if (!settings.maxAttempts || n < settings.maxAttempts) alert();
        }, settings.repeatMinutes * 60000)
      : null;
    return () => {
      clearInterval(timer);
      stopAlarm();
      cancelSpeech();
      rec.current?.abort();
    };
  }, [event.id, event.attemptCount]);
  const listen = async () => {
    setError("");
    setHearing(true);
    try {
      rec.current = await startRecognition();
      const text = (await rec.current.promise)
        .toLowerCase()
        .trim()
        .replace(/[.!?,]/g, "");
      const words = settings.keywords
        .split(",")
        .map((w) => w.trim().toLowerCase());
      if (words.includes(text)) {
        onAck("voice");
      } else if (/отложи|позже/.test(text)) onSnooze();
      else
        setError(
          "Не услышал подтверждение. Нажмите «Понятно» или попробуйте ещё.",
        );
    } catch (e) {
      setError("Не удалось распознать ответ: " + e.message);
    } finally {
      setHearing(false);
    }
  };
  return (
    // Заголовка нет намеренно: человеку нужно увидеть само напоминание, а не
    // «Пора вспомнить» над ним. Подпись осталась только для чтения с экрана.
    <Modal label="Сработавшее напоминание" wide>
      <div className="alarm-icon">
        <Icon name="bell" size={40} />
      </div>
      <p className="alarm-text">{event.text}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary full" onClick={() => onAck("button")}>
        <Icon name="check" />
        Понятно
      </button>
      <button className="secondary full" onClick={onSnooze}>
        Отложить на 5 минут
      </button>
      {settings.voiceAck && (
        <button
          className="text-button full"
          disabled={hearing}
          onClick={listen}
        >
          <Icon name="mic" />
          {hearing ? "Слушаю…" : "Ответить голосом"}
        </button>
      )}
      <p className="hint">
        Подтверждение завершает только это срабатывание, не всю серию.
      </p>
    </Modal>
  );
}
