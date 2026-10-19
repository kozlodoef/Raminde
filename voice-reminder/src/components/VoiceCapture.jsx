import React, { useEffect, useRef, useState } from "react";
import {
  isVoiceSupported,
  startRecognition,
  demoPhrase,
} from "../lib/speech.js";

/**
 * VoiceCapture — большой микрофон-кнопка. Показывает живую расшифровку,
 * по завершении вызывает onResult(текст).
 */
export default function VoiceCapture({ onResult, busy }) {
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef(null);
  const supported = isVoiceSupported();

  useEffect(
    () => () => {
      recRef.current && recRef.current.abort();
    },
    [],
  );

  const begin = async () => {
    if (listening) {
      recRef.current && recRef.current.stop();
      return;
    }
    setError("");
    setLive("…слушаю");
    setListening(true);
    const r = await startRecognition({
      onInterim: (t) => setLive(t || "…"),
      onError: (code) => {
        setListening(false);
        setLive("");
        if (code === "not-allowed" || code === "service-not-allowed") {
          setError(
            "Доступ к микрофону запрещён. Разрешите его в настройках браузера.",
          );
        } else if (code === "no-speech") {
          setError("Я ничего не услышала — попробуйте ещё раз.");
        } else if (code !== "aborted") {
          setError("Не удалось распознать речь. Попробуйте ещё раз.");
        }
      },
      onEnd: () => setListening(false),
    });
    recRef.current = r;
    r.promise
      .then((text) => {
        setListening(false);
        setLive("");
        if (text) onResult(text);
        else setError("Речь не распознана. Скажите фразу чуть громче.");
      })
      .catch(() => {});
  };

  const useDemo = () => onResult(demoPhrase());

  return (
    <div className="mic-zone">
      <button
        className={"mic-btn" + (listening ? " listening" : "")}
        onClick={begin}
        disabled={busy}
        aria-label={listening ? "Остановить запись" : "Начать запись"}
        title={
          supported
            ? listening
              ? "Стоп"
              : "Нажмите и говорите"
            : "Голосовой ввод недоступен в этом браузере"
        }
      >
        {listening ? "👂" : "🎙️"}
      </button>

      {supported ? (
        <div className="hint">
          {listening ? (
            "Говорите свободно, например: «Напомни завтра в половине десятого позвонить врачу»"
          ) : (
            <span>
              <b>Нажмите на микрофон и скажите,</b> о чём и когда напомнить
            </span>
          )}
        </div>
      ) : (
        <div className="hint">
          Голосовое распознавание не поддерживается этим браузером.
          <br />
          Используйте Chrome / Edge / Safari или демо-режим ниже.
        </div>
      )}

      {live && <div className="live-transcript">«{live}»</div>}
      {error && (
        <div className="hint" style={{ color: "#f2a2ae" }}>
          {error}
        </div>
      )}

      {!supported && (
        <button className="btn btn-ghost" onClick={useDemo} disabled={busy}>
          🧪 Демо: случайная фраза
        </button>
      )}
    </div>
  );
}
