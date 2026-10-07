import React, { useCallback, useEffect, useRef, useState } from 'react';
import VoiceCapture from './components/VoiceCapture.jsx';
import ConfirmScreen from './components/ConfirmScreen.jsx';
import ReminderList from './components/ReminderList.jsx';
import AlarmModal from './components/AlarmModal.jsx';
import Settings from './components/Settings.jsx';
import { loadReminders, saveReminders, loadSettings, saveSettings, uid } from './lib/storage.js';
import { planTimer, dueReminders, MAX_TIMEOUT, scheduleAlarm, cancelAlarm, requestNotificationPermission } from './lib/alarm.js';
import { isNative } from './lib/native.js';
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
    // Снимаем таймер: без этого запись остаётся в timersRef навсегда
    // и напоминание больше нельзя перепланировать.
    const timers = timersRef.current;
    if (timers[rem.id]) { clearTimeout(timers[rem.id]); delete timers[rem.id]; }
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
      const plan = planTimer(r.when);
      if (plan.kind === 'invalid') return;   // битую дату не планируем
      if (plan.kind === 'fire') {
        // просроченное — срабатывает сразу при загрузке
        timers[r.id] = setTimeout(() => { fire(r); }, 50);
      } else if (plan.kind === 'wait') {
        timers[r.id] = setTimeout(() => { fire(r); }, plan.delay);
      } else {
        // Дальше лимита setTimeout: ставим «заглушку», по её истечении
        // сбрасываем себя и пересчитываем заново.
        timers[r.id] = setTimeout(() => {
          delete timers[r.id];
          setReminders((prev) => [...prev]); // триггер пересчёта
        }, MAX_TIMEOUT);
      }
    });
  }, [reminders, fire]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
  }, []);

  // В фоновой вкладке браузер сильно тормозит таймеры, поэтому по возвращении
  // проверяем, не наступило ли время, пока вкладка спала.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const due = dueReminders(reminders);
      if (due.length) fire(due[0]);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reminders, fire]);

  // На Android напоминания должны жить в системном будильнике, а не только
  // в таймерах страницы. Здесь просим разрешение на уведомления и ставим все
  // будущие напоминания — это важно после обновления приложения или перезапуска,
  // когда системные будильники могли быть потеряны.
  useEffect(() => {
    if (!isNative()) return;
    requestNotificationPermission();
    reminders.forEach((r) => { if (!r.done) scheduleAlarm(r); });
  }, []);

  // --- Поток создания ---
  const onTranscript = (text) => setPhrase(text);

  const onSaveReminder = ({ text, when }) => {
    const r = { id: uid(), text, when: when.toISOString(), createdAt: Date.now(), done: false };
    persist([...reminders.filter((x) => !x.done), r]);
    setPhrase(null);
    showToast('✅ Напоминание создано: «' + text + '»');
    // На Android ставим системный будильник: таймер страницы не сработает,
    // если приложение выгружено из памяти.
    if (isNative()) {
      scheduleAlarm(r).then((res) => {
        if (!res.scheduled && res.reason === 'past') showToast('⚠️ Это время уже прошло');
      });
    }
    // Запросим разрешение на уведомления заранее, если ещё не спросили
    if (pushSupported() && Notification.permission === 'default') {
      requestPushPermission();
    }
  };

  const onDelete = (id) => {
    if (timersRef.current[id]) { clearTimeout(timersRef.current[id]); delete timersRef.current[id]; }
    const victim = reminders.find((r) => r.id === id);
    if (isNative() && victim) cancelAlarm(victim);
    persist(reminders.filter((r) => r.id !== id));
  };

  const onDismissAlarm = () => {
    if (!firing) return;
    // убираем выполненное напоминание из списка
    if (isNative()) cancelAlarm(firing);
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
