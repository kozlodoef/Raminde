import React, { useState } from 'react';
import { pushSupported, requestPushPermission, playAlarm, stopAlarm, speak } from '../lib/alerts.js';

/**
 * Settings — режим срабатывания: голосовое напоминание либо только push-уведомление
 * после привлекающего звукового сигнала. Плюс проверка разрешения на уведомления
 * и предпросмотр сигнала.
 */
export default function Settings({ settings, onChange, onClose }) {
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  const changeMode = (mode) => {
    onChange({ ...settings, alertMode: mode });
  };

  const togglePush = (v) => {
    onChange({ ...settings, pushEnabled: v });
    if (v && pushSupported() && perm !== 'granted') {
      requestPushPermission().then(setPerm);
    }
  };

  const preview = () => {
    playAlarm(false);
    setTimeout(() => stopAlarm(), 1500);
    if (settings.alertMode === 'voice') {
      setTimeout(() => speak('Это пример голосового напоминания. Полить цветы.'), 1700);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ margin: '0 4px 12px' }}>⚙️ Настройки</div>

        <div className="settings-row">
          <div>
            <div className="lbl">Как напоминать в нужный момент</div>
            <div className="sub">Сразу после этого звучит привлекающий сигнал.</div>
          </div>
        </div>
        <div className="seg" style={{ marginBottom: 8 }}>
          <button className={settings.alertMode === 'voice' ? 'active' : ''} onClick={() => changeMode('voice')}>
            🔊 Голосом
          </button>
          <button className={settings.alertMode === 'push' ? 'active' : ''} onClick={() => changeMode('push')}>
            🔕 Только push
          </button>
        </div>
        <div className="hint" style={{ textAlign: 'left', marginBottom: 10 }}>
          {settings.alertMode === 'voice'
            ? 'После сигнала приложение вслух зачитает, что нужно сделать.'
            : 'После сигнала приложение пришлёт только push-уведомление, без озвучивания.'}
        </div>

        <div className="settings-row">
          <div>
            <div className="lbl">
              Push-уведомления{' '}
              {!pushSupported()
                ? <span className="badge denied">не поддерживаются</span>
                : <span className={'badge ' + perm}>{perm === 'granted' ? 'разрешены' : perm === 'denied' ? 'запрещены браузером' : 'нужно разрешение'}</span>}
            </div>
            <div className="sub">Показывать уведомление системы в момент напоминания.</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.pushEnabled} onChange={(e) => togglePush(e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <div className="lbl">Проверка сигнала и голоса</div>
            <div className="sub">Прослушать, как будет звучать напоминание.</div>
          </div>
          <button className="icon-btn" onClick={preview}>▶</button>
        </div>

        <div style={{ height: 16 }} />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
