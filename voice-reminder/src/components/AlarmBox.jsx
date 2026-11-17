// components/AlarmBox.jsx — экран сработавшего напоминания.
//
// Две ветки поведения:
//  • браузер — сигнал, уведомление и озвучку делает сам экран (таймерами);
//  • Android — всё это делает нативный DeliveryService, поэтому здесь стоит
//    ранний выход: иначе звук и голос сработали бы дважды.
import React, { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { isNative } from "../lib/native.js";
import { startRecognition } from "../lib/speech.js";
import { speak, cancelSpeech, playAlarm, stopAlarm, sendPush } from "../lib/alerts.js";
import { languageTag, t } from "../domain/i18n.js";

export default function AlarmBox({ event, settings, onAck, onSnooze }) {
  const language = settings.language || "ru";
  const copy = (key, values) => t(language, key, values);
  const [hearing, setHearing] = useState(false),
    [error, setError] = useState(""),
    rec = useRef();
  useEffect(() => {
    if (isNative()) return;
    let n = 0;
    const alert = () => {
      n++;
      if (settings.sound) playAlarm(false, settings.soundVariant);
      // Режим «Только уведомление»: звук и уведомление, без озвучивания текста.
      // Режим «Голос + уведомление»: то же плюс TTS.
      sendPush(
        language === "en" ? "Remind me" : "Напоминание",
        settings.privateNotification
          ? (language === "en" ? "New reminder" : "Новое напоминание")
          : event.text,
      );
      if (settings.mode === "voiceAndNotification")
        speak((settings.name ? settings.name + "! " : "") + event.text, { lang: languageTag(settings.language || "ru") });
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
    // Настройки входят в зависимости: при их изменении сигнал пересоздаётся
    // с актуальными режимом, звуком и интервалом повтора, а не продолжает
    // работать со старыми значениями из замыкания.
  }, [
    event.id,
    event.attemptCount,
    settings.mode,
    settings.sound,
    settings.soundVariant,
    settings.repeat,
    settings.repeatMinutes,
    settings.maxAttempts,
    settings.privateNotification,
    settings.name,
    settings.language,
  ]);
  const listen = async () => {
    setError("");
    setHearing(true);
    try {
      rec.current = await startRecognition({ lang: languageTag(language) });
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
        setError(language === "en"
          ? "I did not hear a confirmation. Press ‘Got it’ or try again."
          : "Не услышал подтверждение. Нажмите «Понятно» или попробуйте ещё.");
    } catch (e) {
      setError((language === "en" ? "Could not recognize the response: " : "Не удалось распознать ответ: ") + e.message);
    } finally {
      setHearing(false);
    }
  };
  return (
    <Modal title={language === "en" ? "Time to remember" : "Пора вспомнить"} closeLabel={copy("close")} wide>
      <div className="alarm-icon">
        <Icon name="bell" size={40} />
      </div>
      <h3 className="alarm-name">
        {settings.name ? settings.name + "!" : copy("reminder")}
      </h3>
      <p className="alarm-text">{event.text}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary full" onClick={() => onAck("button")}>
        <Icon name="check" />
        {copy("acknowledge")}
      </button>
      <button className="secondary full" onClick={onSnooze}>
        {copy("snooze")}
      </button>
      {settings.voiceAck && (
        <button
          className="text-button full"
          disabled={hearing}
          onClick={listen}
        >
          <Icon name="mic" />
          {hearing ? copy("listening") : copy("replyByVoice")}
        </button>
      )}
      <p className="hint">
        {copy("acknowledgeHint")}
      </p>
    </Modal>
  );
}
