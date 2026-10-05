import React, { useCallback, useEffect, useRef, useState } from 'react';
import VoiceCapture from './components/VoiceCapture.jsx';
import ConfirmScreen from './components/ConfirmScreen.jsx';
import ReminderList from './components/ReminderList.jsx';
import AlarmModal from './components/AlarmModal.jsx';
import Settings from './components/Settings.jsx';
import { loadReminders, saveReminders, loadSettings, saveSettings, uid } from './lib/storage.js';
import { sendPush, requestPushPermission, primeAudio, pushSupported } from './lib/alerts.js';

export default function App() {
  const [reminders, setReminders] = useState(() => loadReminders());
  const [settings, setSettings] = useState(() => loadSettings());
  const [phrase, setPhrase] = useState(null);      // расшифровка для подтверждения
  const [firing, setFiring] = useState(null);       // напоминание, которое сработало
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState('');
  const timersRef = useRef({});

  useEffect(() => { primeAudio(); }, []);

  const showToast = (t) => {
    setToast(t);
    setTimeout(() => setToast(''), 2600);
  };

  const persist = useCallback((list) => {
    setReminders(list);
    saveReminders(list);
  }, []);

  // --- Планирование таймеров ---
  const fire = useCallback((rem) => {
    setFiring(rem);
    if (settings.pushEnabled && pushSupported()) {
      if (Notification.permission === 'granted') {
        sendPush('⏰ Напоминание', rem.text);
      } else if (settings.alertMode === 'push') {
        requestPushPermission().then((p) => {
          if (p === 'granted') sendPush('⏰ Напоминание', rem.text);
        });
      }
    }
  }, [settings]);

  useEffect(() => {
    const timers = timersRef.current;
    reminders.forEach((r) => {
      if (r.done || timers[r.id]) return;
      const delay = new Date(r.when).getTime() - Date.now();
      if (delay <= 0) {
        // просроченное — срабатывает сразу при загрузке
        timers[r.id] = setTimeout(() => { fire(r); }, 50);
      } else if (delay < 2 ** 31 - 1) {
        timers[r.id] = setTimeout(() => { fire(r); }, delay);
      } else {
        // дальше 24 дней — перепроверим позже
        timers[r.id] = setTimeout(() => {
          delete timers[r.id];
          setReminders((prev) => [...prev]); // триггер пересчёта
        }, 2 ** 31 - 2);
      }
    });
  }, [reminders, fire]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
  }, []);

  // --- Поток создания ---
  const onTranscript = (text) => setPhrase(text);

  const onSaveReminder = ({ text, when }) => {
    const r = { id: uid(), text, when: when.toISOString(), createdAt: Date.now(), done: false };
    persist([...reminders.filter((x) => !x.done), r]);
    setPhrase(null);
    showToast('✅ Напоминание создано: «' + text + '»');
    // Запросим разрешение на уведомления заранее, если ещё не спросили
    if (pushSupported() && Notification.permission === 'default') {
      requestPushPermission();
    }
  };

  const onDelete = (id) => {
    if (timersRef.current[id]) { clearTimeout(timersRef.current[id]); delete timersRef.current[id]; }
    persist(reminders.filter((r) => r.id !== id));
  };

  const onDismissAlarm = () => {
    if (!firing) return;
    // убираем выполненное напоминание из списка
    persist(reminders.filter((r) => r.id !== firing.id));
    setFiring(null);
  };

  const onChangeSettings = (s) => {
    setSettings(s);
    saveSettings(s);
  };

  return (
    <div>
      <header className="app-header">
        <div className="app-title">
          <img src="/bell.svg" alt="" className="logo" />
          Голосовая напоминалка
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Настройки" aria-label="Настройки">⚙️</button>
      </header>

      {phrase ? (
        <ConfirmScreen
          phrase={phrase}
          onSave={onSaveReminder}
          onCancel={() => setPhrase(null)}
        />
      ) : (
        <div className="card">
          <VoiceCapture onResult={onTranscript} busy={!!firing} />
        </div>
      )}

      {!phrase && (
        <>
          <div className="section-title">Активные напоминания</div>
          <ReminderList items={reminders} onDelete={onDelete} />
        </>
      )}

      <div className="footer-note">
        Скажите, например: «Напомни завтра в половине десятого позвонить врачу».<br />
        Работает в Chrome, Edge, Safari. Держите вкладку открытой в момент напоминания.
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          background: '#1d2242', border: '1px solid #3a4180', padding: '10px 18px',
          borderRadius: 12, zIndex: 90, boxShadow: '0 8px 30px rgba(0,0,0,.4)', fontSize: 15,
        }}>{toast}</div>
      )}

      {firing && (
        <AlarmModal reminder={firing} settings={settings} onDismiss={onDismissAlarm} />
      )}

      {showSettings && (
        <Settings settings={settings} onChange={onChangeSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
