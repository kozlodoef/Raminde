import React, { useEffect, useState } from 'react';
import { pushSupported, requestPushPermission, playAlarm, speak, stopAlarm, cancelSpeech, ttsAvailable } from '../lib/alerts.js';

/**
 * AlarmModal — полноэкранное привлекающее внимание окно в момент срабатывания:
 * мигающая карточка + зацикленный звуковой сигнал. Далее по настройке:
 *  alertMode='voice' → голосом зачитывает действие;
 *  alertMode='push'  → только push-уведомление после сигнала.
 */
export default function AlarmModal({ reminder, settings, onDismiss }) {
  const [phase, setPhase] = useState('ringing'); // ringing -> spoken
  const canTts = ttsAvailable();

  useEffect(() => {
    let alive = true;
    // Звуковой сигнал сразу, зацикленно
    playAlarm(true);

    const t = setTimeout(() => {
      if (!alive) return;
      stopAlarm();
      if (settings.alertMode === 'voice' && canTts) {
        speak(`Время напоминания! ${reminder.text}`, {
          onend: () => alive && setPhase('spoken'),
        });
        setPhase('speaking');
        // страховка, если onend не выстрелит
        setTimeout(() => alive && setPhase('spoken'), 12000);
      } else {
        setPhase('spoken');
      }
    }, 2600);

    return () => {
      alive = false;
      clearTimeout(t);
      stopAlarm();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminder.id]);

  const dismiss = () => {
    stopAlarm();
    cancelSpeech();
    onDismiss();
  };

  return (
    <div className="overlay" role="alertdialog" aria-modal="true">
      <div className="alert-card">
        <span className="bell-big">🔔</span>
        <div className="alert-title">Напоминание!</div>
        <div className="alert-text">{reminder.text}</div>
        {phase === 'speaking' && (
          <div className="hint" style={{ marginBottom: 12 }}>🔊 Озвучиваю…</div>
        )}
        {settings.pushEnabled && phase !== 'ringing' && (
          <div className="hint" style={{ marginBottom: 12 }}>
            Push-уведомление отправлено{pushSupported() ? '' : ' (браузер не поддерживает)'}
          </div>
        )}
        <div className="btn-row">
          <button className="btn btn-primary" onClick={dismiss}>Понятно ✔</button>
          {settings.alertMode === 'voice' && canTts && phase !== 'ringing' && (
            <button
              className="btn btn-secondary"
              onClick={() => speak(`Время напоминания! ${reminder.text}`)}
            >🔁 Повторить</button>
          )}
        </div>
      </div>
    </div>
  );
}
