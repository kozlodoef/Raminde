import React, { useEffect, useRef, useState } from "react";
import { isNative } from "./lib/native.js";
import { startRecognition } from "./lib/speech.js";
import {
  playAlarm,
  playSwish,
  stopAlarm,
  primeAudio,
} from "./lib/alerts.js";
import { parseIntents } from "./domain/intent.js";
// (импорт из ./domain/draftValidation.js больше не нужен)
import {
  localDate,
  nextOccurrences,
  shortTime,
  zone,
  zonedTime,
} from "./domain/calendar.js";
import {
  getState,
  setSettings,
  putReminder,
  deleteReminder,
  excludeDate,
  acknowledge,
  snooze,
  fireWeb,
  permissions,
  requestPermissions,
  speakName,
} from "./domain/repository.js";
import {
  billingConfigured,
  billingStatus,
  reserveQuota,
  commitQuota,
  releaseQuota,
  checkout,
  recoveryKey,
  restoreKey,
} from "./domain/billing.js";
import {
  findCapacityConflicts,
  dateSelectionConflict,
  findTimeConflicts,
  nextReminderColor,
  stableReminderColor,
  scheduleForSelectedDates,
  toggleDateSelection,
} from "./domain/interaction.js";
import { languageTag, localizeIssue, t } from "./domain/i18n.js";

// UI вынесен в отдельные модули: App отвечает только за состояние и поток данных.
import AlarmBox from "./components/AlarmBox.jsx";
import Calendar from "./components/Calendar.jsx";
import EditReminder from "./components/EditReminder.jsx";
import Icon from "./components/Icon.jsx";
import Modal from "./components/Modal.jsx";
import Select from "./components/Select.jsx";
import TimeWheel from "./components/TimeWheel.jsx";
import Toggle from "./components/Toggle.jsx";
export default function App() {
  const [state, setState] = useState(null),
    [perms, setPerms] = useState(null),
    [modal, setModal] = useState(null),
    [drafts, setDrafts] = useState([]),
    [listening, setListening] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [bill, setBill] = useState(null),
    [receiptEmail, setReceiptEmail] = useState(""),
    [restoreCode, setRestoreCode] = useState(""),
    [displayKey, setDisplayKey] = useState(""),
    [onboardingStep, setOnboardingStep] = useState(0),
    [tutorialDate, setTutorialDate] = useState(null),
    [composerText, setComposerText] = useState(""),
    [draftDates, setDraftDates] = useState([]),
    [selectedDate, setSelectedDate] = useState(localDate()),
    [screen, setScreen] = useState("home"),
    [deleteTarget, setDeleteTarget] = useState(null),
    [timeTarget, setTimeTarget] = useState(null),
    [timeValue, setTimeValue] = useState(""),
    [removing, setRemoving] = useState(null),
    [composerFocused, setComposerFocused] = useState(false);
  const recording = useRef(),
    pendingStop = useRef(false),
    autoStarted = useRef(false),
    previousScreen = useRef("home"),
    mounted = useRef(true);
  const issueMessage = (error) =>
    localizeIssue(state?.settings?.language || "ru", error?.message || error);
  const refresh = async () => {
    try {
      const s = await (isNative() ? getState() : fireWeb());
      if (mounted.current) setState(s);
    } catch (e) {
      setMessage(issueMessage(e));
    }
  };
  useEffect(() => {
    mounted.current = true;
    primeAudio();
    refresh();
    permissions()
      .then(setPerms)
      .catch((e) => setMessage(issueMessage(e)));
    const timer = setInterval(refresh, 1500);
    const visible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        permissions().then(setPerms);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      recording.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (state && !state.settings.onboarded && !modal) {
      setName(state.settings.name || "");
      setOnboardingStep(0);
      setModal("onboarding");
    }
  }, [!!state]);
  useEffect(() => {
    // РњРёРєСЂРѕС„РѕРЅ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЏРІРЅС‹Рј РЅР°Р¶Р°С‚РёРµРј В«РќР°С‡Р°С‚СЊВ».
    // РђРІС‚РѕР·Р°РїСѓСЃРє РїСЂРё РІС…РѕРґРµ РЅР° РіР»Р°РІРЅС‹Р№ СЌРєСЂР°РЅ РЅР°РјРµСЂРµРЅРЅРѕ РѕС‚РєР»СЋС‡С‘РЅ.
    autoStarted.current = true;
  }, []);
  useEffect(() => {
    const changedSection = previousScreen.current !== screen;
    if (changedSection && screen !== "home") stop();
    previousScreen.current = screen;
  }, [screen]);
  useEffect(() => {
    if (modal === "settings" || modal === "editor" || modal === "subscription") stop();
  }, [modal]);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state?.settings.theme]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const say = async () => {
    pendingStop.current = false;
    setMessage("");
    setListening(true);
    const recognitionLanguage = state?.settings?.language || "ru";
    setComposerText("");
    try {
      // Recording always starts with an audible cue; the setting controls delivery alerts.
      playAlarm(false, state?.settings?.soundVariant || "soft");
      setTimeout(stopAlarm, 700);
      const session = await startRecognition({
        lang: languageTag(state?.settings?.language || "ru"),
        onInterim: (text) => setComposerText(text || ""),
      });
      recording.current = session;
      if (pendingStop.current || !mounted.current) {
        await session.abort();
        return;
      }
      const text = await session.promise;
      if (!text) {
        setMessage(t(recognitionLanguage, "speechEmpty"));
        return;
      }
      if (modal === "onboarding") {
        setName(text.replace(/[.!?]/g, ""));
        return;
      }
      setComposerText(text);
    } catch (e) {
      setMessage(t(recognitionLanguage, e.message.includes("not-allowed") ? "micPermission" : "speechUnavailable"));
    } finally {
      recording.current = null;
      setListening(false);
    }
  };
  const stop = () => {
    pendingStop.current = true;
    recording.current?.stop();
  };
  const finishComposer = async () => {
    if (listening) {
      stop();
      return;
    }
    if (!composerText.trim()) {
      say();
      return;
    }
    const parsed = parseIntents(composerText);
    if (draftDates.length) {
      if (parsed.some((draft) => dateSelectionConflict(draft.schedule, draftDates, draft.dateFound))) {
        setMessage(language === "en"
          ? "The spoken date differs from the selected calendar dates. Correct the selection before saving."
          : "Р”Р°С‚Р° РёР· С„СЂР°Р·С‹ РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ РІС‹Р±СЂР°РЅРЅС‹РјРё РґР°С‚Р°РјРё. РСЃРїСЂР°РІСЊС‚Рµ РІС‹Р±РѕСЂ РїРµСЂРµРґ СЃРѕС…СЂР°РЅРµРЅРёРµРј.");
        setDrafts(parsed);
        setModal("editor");
        return;
      }
      for (const draft of parsed) {
        draft.schedule = scheduleForSelectedDates(draft.schedule, draftDates);
      }
    }
    if (parsed.length === 1 && !parsed[0].issues?.length) {
      const candidate = {
        ...parsed[0],
        id: parsed[0].id || uid(),
        enabled: true,
        createdAt: Date.now(),
      };
      try {
        await save(candidate);
        setDraftDates([]);
        setComposerText("");
        return;
      } catch (error) {
        if (error.message === "QUOTA") return;
        setMessage(error.message);
        return;
      }
    }
    setDrafts(parsed);
    setModal("editor");
  };
  const saveSettings = async (patch) => {
    try {
      setState(await setSettings({ ...state.settings, ...patch }));
    } catch (e) {
      setMessage(t(state.settings.language || "ru", "settingsSaveFailed") + ": " + e.message);
    }
  };
  const save = async (r) => {
    setBusy(true);
    let token,
      saved = false;
    try {
      const existing = state.reminders;
      const capacity = findCapacityConflicts(r, existing);
      if (capacity.length)
        throw new Error(t(language, "capacityConflict", { date: capacity[0].date }));
      const conflicts = findTimeConflicts(r, existing);
      if (conflicts.length)
        throw new Error(t(language, "timeConflict", conflicts[0]));
      if (!state.reminders.some((x) => x.id === r.id) && billingConfigured) {
        const reserved = await reserveQuota(r.id);
        token = reserved.token;
      }
      setState(await putReminder(
        Number.isInteger(r.colorIndex) ? r : { ...r, colorIndex: nextReminderColor(existing) },
        { reservation: token },
      ));
      saved = true;
      if (token) {
        try {
          await commitQuota(token);
        } catch {
          const pending = JSON.parse(
            localStorage.getItem("raminde.pendingQuota") || "[]",
          );
          localStorage.setItem(
            "raminde.pendingQuota",
            JSON.stringify([...new Set([...pending, token])]),
          );
        }
      }
    } catch (e) {
      if (token && !saved) await releaseQuota(token).catch(() => {});
      if (e.message === "QUOTA") {
        setMessage(t(language, "quotaExhausted"));
        setModal("subscription");
      }
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const loadBill = async () => {
    try {
      const pending = JSON.parse(
        localStorage.getItem("raminde.pendingQuota") || "[]",
      );
      for (const token of pending) await commitQuota(token);
      localStorage.removeItem("raminde.pendingQuota");
      setBill(await billingStatus());
    } catch (e) {
      setMessage(issueMessage(e));
    }
  };
  if (!state)
    return (
      <main className="app">
        <h1>Remind me</h1>
        <p>{t("ru", "loading")}</p>
        {message && <p className="error">{message}</p>}
      </main>
    );
  const settings = state.settings,
    language = settings.language || "ru",
    copy = (key, values) => t(language, key, values),
    active = state.events.filter((e) =>
      ["ringing", "waiting"].includes(e.state),
    ),
    alarm = active[0],
    reminders = [...state.reminders].sort(
      (a, b) => (a.nextTriggerAt || Infinity) - (b.nextTriggerAt || Infinity),
    ),
    selectedReminders = reminders.filter((reminder) => {
      const schedule = reminder.schedule;
      const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
      if (schedule.kind === "once")
        return localDate(new Date(schedule.at), tz) === selectedDate;
      return nextOccurrences(
        schedule,
        zonedTime(selectedDate, "00:00", tz) - 1,
        32,
      ).some((when) => localDate(new Date(when), tz) === selectedDate);
    });
  const selectedLabel = new Intl.DateTimeFormat(languageTag(language), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${selectedDate}T12:00:00`));
  const openEvents = (date = selectedDate) => {
    setSelectedDate(date);
    setScreen("events");
  };
  const removeWithAnimation = (id, action) => {
    playSwish();
    setRemoving(id);
    setTimeout(async () => {
      try {
        const next = await action();
        if (next) setState(next);
      } catch (e) {
        setMessage(issueMessage(e));
      } finally {
        setRemoving(null);
      }
    }, 640);
  };
  const removeAllWithAnimation = async () => {
    const items = [...selectedReminders];
    for (const reminder of items) {
      playSwish();
      setRemoving(reminder.id);
      await new Promise((resolve) => setTimeout(resolve, 640));
      try {
        const next = await excludeDate(reminder, selectedDate);
        if (next) setState(next);
      } catch (e) {
        setMessage(issueMessage(e));
        break;
      } finally {
        setRemoving(null);
      }
    }
    try {
      setState(await getState());
    } catch (e) {
      setMessage(issueMessage(e));
    }
  };
  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <h1 className="brand-name">
            remind me
          </h1>
        </div>
        <button
          className="icon-button"
          aria-label={copy("settings")}
          onClick={() => setModal("settings")}
        >
          <Icon name="settings" />
        </button>
      </header>
      {!isNative() && (
        <p className="platform-note">
          {copy("webPreview")}
        </p>
      )}
      {isNative() &&
        perms &&
        (!perms.exact || perms.notifications !== "granted") && (
          <button
            className="notice full"
            onClick={() =>
              requestPermissions()
                .then(setPerms)
                .catch((e) => setMessage(issueMessage(e)))
            }
          >
            {copy("permissionPrompt")}
          </button>
        )}
      {screen === "home" ? <>
      <section className="hero">
        <div className="composer-wrap">
          <textarea
            className="composer"
            rows={2}
            value={composerText}
            aria-label={copy("reminderText")}
            placeholder={composerFocused ? "" : copy("placeholder")}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(e) => {
              stop();
              setComposerText(e.target.value);
              setMessage("");
            }}
          />
          <button
            type="button"
            className="composer-clear"
            aria-label={language === "en" ? "Clear text" : "РћС‡РёСЃС‚РёС‚СЊ С‚РµРєСЃС‚"}
            onClick={() => {
              stop();
              setComposerText("");
              setDrafts([]);
              setDraftDates([]);
              setMessage("");
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <button
          type="button"
          className={"composer-trigger" + (listening ? " listening" : composerText.trim() ? " has-text" : "")}
          aria-label={language === "en"
            ? (listening ? "Done" : composerText.trim() ? "Done" : "Start")
            : (listening ? "Р“РѕС‚РѕРІРѕ" : composerText.trim() ? "Р“РѕС‚РѕРІРѕ" : "РќР°С‡Р°С‚СЊ")}
          onClick={() => {
            if (listening) stop();
            else if (composerText.trim()) finishComposer();
            else say();
          }}
          disabled={!!alarm}
        >
          <Icon name={listening ? "stop" : composerText.trim() ? "check" : "mic"} size={18} />
          {language === "en"
            ? (listening ? "Done" : composerText.trim() ? "Done" : "Start")
            : (listening ? "Р“РѕС‚РѕРІРѕ" : composerText.trim() ? "Р“РѕС‚РѕРІРѕ" : "РќР°С‡Р°С‚СЊ")}
        </button>
      </section>
      <Calendar
        reminders={reminders}
        selectedDate={selectedDate}
        draftDates={draftDates}
        creating={Boolean(listening || composerText.trim() || draftDates.length)}
        language={language}
        onSelect={setSelectedDate}
        onToggleDate={(date) => setDraftDates((dates) => toggleDateSelection(dates, date))}
        onLongPress={openEvents}
      />
      </> : <section className="events-screen">
        <header className="events-header">
          <button className="back-link" onClick={() => setScreen("home")}>
            <span aria-hidden="true">вЂ№</span> {copy("home")}
          </button>
          <h2>{selectedLabel}</h2>
          <span>{selectedReminders.length} {copy("planned")}</span>
          {selectedReminders.length > 0 && (
            <button
              className="events-clear"
              onClick={removeAllWithAnimation}
            >
              {language === "en" ? "Delete all" : "РЈРґР°Р»РёС‚СЊ РІСЃРµ"}
            </button>
          )}
        </header>
        <div className="events-list">
        {!selectedReminders.length ? (
          <div className="empty-state">
            <Icon name="bell" size={28} />
            <h3>{copy("empty")}</h3>
            <p>{copy("emptyHint")}</p>
          </div>
        ) : (
          selectedReminders.map((r) => {
            const color = stableReminderColor(r.id, r.colorIndex);
            const expired = !r.enabled || (r.nextTriggerAt && r.nextTriggerAt < Date.now());
            const eventTime = r.nextTriggerAt
              ? shortTime(r.nextTriggerAt, r.schedule.timezoneMode === "fixed" ? r.schedule.timezone : zone(), language)
              : r.schedule.times?.[0] || (r.schedule.at ? shortTime(new Date(r.schedule.at).getTime(), r.schedule.timezoneMode === "fixed" ? r.schedule.timezone : zone(), language) : "");
            return (
              <article
                className={"reminder event-card" + (expired ? " expired" : "") + (removing === r.id ? " removing" : "")}
                style={{ "--event-color": color }}
                key={r.id}
              >
                <div className="event-card-main">
                  <div className="event-card-time">{eventTime}</div>
                  <input
                    className="toggle"
                    type="checkbox"
                    checked={r.enabled}
                    aria-label={t(language, "toggleAria", { text: r.text })}
                    onChange={() => {
                      // РџСЂРѕС€РµРґС€РµРµ СЃРѕР±С‹С‚РёРµ РЅРµР»СЊР·СЏ В«РІРєР»СЋС‡РёС‚СЊВ»: С‚СѓРјР±Р»РµСЂ СѓРґР°Р»СЏРµС‚ РµРіРѕ,
                      // РєР°Рє Рё СЃРѕРІРµСЂС€РёРІС€РµРµСЃСЏ РЅР°РїРѕРјРёРЅР°РЅРёРµ.
                      if (!expired && !r.enabled) {
                        putReminder({ ...r, enabled: true })
                          .then((next) => setState(next))
                          .catch((ex) => setMessage(issueMessage(ex)));
                        return;
                      }
                      const repeatDays = r.schedule.kind !== "once" && r.schedule.specificDates?.length !== 1;
                      if (repeatDays) setDeleteTarget(r);
                      else removeWithAnimation(r.id, () => deleteReminder(r.id));
                    }}
                  />
                </div>
                <h3>{r.text}</h3>
                <footer className="event-card-footer">
                  <button
                    className="event-handle"
                    aria-label={t(language, "editAria", { text: r.text })}
                    onClick={() => {
                      setTimeTarget(r);
                      setTimeValue(eventTime || "09:00");
                    }}
                  >
                    <Icon name="edit" size={16} />
                    <span>{language === "en" ? "Change time" : "РР·РјРµРЅРёС‚СЊ РІСЂРµРјСЏ"}</span>
                  </button>
                </footer>
              </article>
            );
          })
        )}
        </div>
      </section>}
      {message && (
        <div className="feedback" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label={copy("hideMessage")}
            onClick={() => setMessage("")}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {state.errors?.message && (
        <p className="notice">{state.errors.message}</p>
      )}
      {billingConfigured && (
        <div className="quota-bar" aria-label={language === "en" ? "Subscription settings" : "РќР°СЃС‚СЂРѕР№РєРё РїРѕРґРїРёСЃРєРё"}>
          <span>{language === "en" ? "Subscription settings" : "РќР°СЃС‚СЂРѕР№РєРё РїРѕРґРїРёСЃРєРё"}</span>
          <button className="text-button" onClick={() => { setModal("subscription"); loadBill(); }}>{copy("open")}</button>
        </div>
      )}
      {modal === "onboarding" && (
      <Modal title={onboardingStep === 0 ? copy("onboarding") : copy("tutorialTitle")} closeLabel={copy("close")} className="onboarding-sheet">
          {onboardingStep === 0 ? <>
            <p>{copy("greetingPrompt")}</p>
            <label className="field">
              {copy("name")}
              <input autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={copy("namePlaceholder")} />
            </label>
            <label className="field">
              {copy("language")}
              <Select
                value={language}
                ariaLabel={copy("language")}
                onChange={(value) => saveSettings({ language: value })}
                options={[
                  { value: "ru", label: copy("russian") },
                  { value: "en", label: copy("english") },
                ]}
              />
            </label>
            <button className="secondary full" onClick={listening ? stop : say}>
              <Icon name="mic" /> {listening ? copy("stop") : copy("speakName")}
            </button>
            <button className="primary full" onClick={() => setOnboardingStep(1)}>{copy("next")}</button>
          </> : <>
            <p>{copy("tutorialText")}</p>
            <div className="tutorial-demo" aria-label={copy("tutorialCalendar")}>
              {[12, 13, 14, 15, 16, 17, 18].map((day) => (
                <button key={day} className={tutorialDate === day ? "selected" : ""} onClick={() => setTutorialDate(tutorialDate === day ? null : day)}>{day}</button>
              ))}
            </div>
            <p className="hint">{copy("tutorialCalendar")}</p>
            <button className="secondary full" onClick={() => setTutorialDate(null)}>{copy("start")} / {copy("done")}</button>
            <p className="hint">{copy("tutorialButton")}</p>
            <p className="hint">{copy("tutorialEvents")}</p>
            <button className="primary full" onClick={async () => { await saveSettings({ name: name.trim(), onboarded: true }); setModal(null); }}>{copy("begin")}</button>
          </>}
          <button className="text-button full" onClick={async () => { await saveSettings({ name: "", onboarded: true }); setModal(null); }}>{copy("skip")}</button>
        </Modal>
      )}
      {modal === "editor" && drafts.length > 0 && (
        <EditReminder
          key={`${drafts[0].id || "new"}-${drafts.length}`}
          initial={drafts[0]}
          queueSize={drafts.length}
          settings={settings}
          language={language}
          busy={busy}
          onSave={async (savedReminder) => {
            await save(savedReminder);
            setDrafts((items) => {
              const remaining = items.slice(1);
              if (!remaining.length) {
                setModal(null);
                setDraftDates([]);
                setComposerText("");
              }
              return remaining;
            });
          }}
          onClose={() => {
            setModal(null);
            setDrafts([]);
            setDraftDates([]);
          }}
        />
      )}
      {modal === "settings" && (
        <Modal title={copy("settings")} closeLabel={copy("close")} onClose={() => setModal(null)}>
          <label className="field">
            {copy("settingsName")}
            <input
              value={settings.name}
              onChange={(e) => saveSettings({ name: e.target.value })}
            />
          </label>
          <label className="field">
            {copy("mode")}
            <Select
              value={settings.mode}
              ariaLabel={copy("mode")}
              onChange={(mode) => saveSettings({ mode })}
              options={[
                { value: "notification", label: copy("notification") },
                { value: "voiceAndNotification", label: copy("voiceAndNotification") },
              ]}
            />
          </label>
          <label className="field">
            {copy("language")}
            <Select
              value={language}
              ariaLabel={copy("language")}
              onChange={(value) => saveSettings({ language: value })}
              options={[
                { value: "ru", label: copy("russian") },
                { value: "en", label: copy("english") },
              ]}
            />
          </label>
          <label className="field">
            {copy("soundVariant")}
            <Select
              value={settings.soundVariant || "soft"}
              ariaLabel={copy("soundVariant")}
              onChange={(soundVariant) => saveSettings({ soundVariant })}
              options={[
                { value: "soft", label: copy("soft") },
                { value: "bright", label: copy("bright") },
                { value: "pulse", label: copy("pulse") },
              ]}
            />
          </label>
          <button className="secondary full" onClick={() => setModal("instructions")}>{copy("instructions")}</button>
          <Toggle
            label={copy("sound")}
            value={settings.sound}
            onChange={(v) => saveSettings({ sound: v })}
          />
          <Toggle
            label={copy("vibration")}
            value={settings.vibration}
            onChange={(v) => saveSettings({ vibration: v })}
          />
          <Toggle
            label={copy("repeat")}
            value={settings.repeat}
            onChange={(v) => saveSettings({ repeat: v })}
          />
          {settings.repeat && (
            <>
              <label className="field">
                {copy("repeatEvery")}
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={settings.repeatMinutes}
                  onChange={(e) => {
                    if (+e.target.value >= 1)
                      saveSettings({ repeatMinutes: +e.target.value });
                  }}
                />
              </label>
              <label className="field">
                {copy("maxAttempts")}
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={settings.maxAttempts}
                  onChange={(e) =>
                    saveSettings({ maxAttempts: Math.max(0, +e.target.value) })
                  }
                />
              </label>
              <p className="hint">
                {copy("androidRepeatHint")}
              </p>
            </>
          )}
          <Toggle
            label={copy("voiceAck")}
            description={copy("voiceAckHint")}
            value={settings.voiceAck}
            onChange={(v) => saveSettings({ voiceAck: v })}
          />
          <label className="field">
            {copy("keywords")}
            <input
              value={settings.keywords}
              onChange={(e) => saveSettings({ keywords: e.target.value })}
            />
          </label>
          <Toggle
            label={copy("privateNotification")}
            value={settings.privateNotification}
            onChange={(v) => saveSettings({ privateNotification: v })}
          />
          <label className="field">
            {copy("theme")}
            <Select
              value={settings.theme}
              ariaLabel={copy("theme")}
              onChange={(theme) => saveSettings({ theme })}
              options={[
                { value: "system", label: copy("system") },
                { value: "light", label: copy("light") },
                { value: "dark", label: copy("dark") },
              ]}
            />
          </label>
          <Toggle
            label={copy("pickerSound")}
            value={settings.pickerSound}
            onChange={(v) => saveSettings({ pickerSound: v })}
          />
          <button
            className="secondary full"
            onClick={() =>
              requestPermissions()
                .then(setPerms)
                .catch((e) => setMessage(issueMessage(e)))
            }
          >
            {copy("permissions")}
          </button>
          <button
            className="secondary full"
            onClick={() =>
              speakName(
                (settings.name ? settings.name + "! " : "") +
                  copy("voiceTestText"),
                language,
              ).catch((e) => setMessage(issueMessage(e)))
            }
          >
            {copy("voiceTest")}
          </button>
          {isNative() && state.recovery && (
            <section aria-label={copy("recoveryDiagnostics")}>
              <h3>{copy("afterReboot")}</h3>
              <p className="hint">{copy("versionLabel")}: {state.recovery.appVersion}</p>
              <p className="hint">
                {copy("bootSignal")}:{" "}
                {state.recovery.bootConfirmed
                  ? copy("received")
                  : state.recovery.currentBootCount < 0
                    ? copy("couldNotCheck")
                    : copy("notReceived")}
                .
              </p>
              <p className="hint">
                {copy("lastRestore")}:{" "}
                {state.recovery.source === "app_resume"
                  ? copy("appOpen")
                  : state.recovery.source || copy("notStarted")}
                .
                {state.recovery.completedAt
                  ? ` ${copy("restoredSignals", { count: state.recovery.scheduled || 0 })}.`
                  : state.recovery.startedAt
                    ? ` ${copy("restoreNotCompleted")}.`
                    : ""}
              </p>
              {state.recovery.bootConfirmed && (
                <p className="hint">
                  {copy("bootRestore")}:{" "}
                  {state.recovery.bootRestore?.completedAt
                    ? copy("completedSignals", { count: state.recovery.bootRestore.scheduled || 0 })
                    : copy("restoreNotCompleted")}
                  .
                  {state.recovery.bootRestore?.error
                    ? ` ${copy("restoreError", { error: state.recovery.bootRestore.error })}`
                    : ""}
                </p>
              )}
              {state.recovery.error && (
                <p className="error">{state.recovery.error}</p>
              )}
              <p className="hint">{copy("bootWarning")}</p>
            </section>
          )}
          <p className="hint">{copy("screenOpenNote")}</p>
        </Modal>
      )}
      {modal === "subscription" && (
        <Modal
          title={copy("subscriptionTitle")}
          closeLabel={copy("close")}
          onClose={() => setModal(drafts.length ? "editor" : null)}
        >
          <p>{copy("subscriptionIntro")}</p>
          <div className="summary">
            <strong>
              {bill?.premium
                ? copy("subscriptionActive")
                : copy("subscriptionRemaining", { count: Math.max(0, 10 - (bill?.used ?? state.quota.used)) })}
            </strong>
            <small>
              {copy("subscriptionAfter")}
            </small>
          </div>
          {!billingConfigured || bill?.configured === false ? (
            <p className="notice">
              {copy("billingUnavailable")}
            </p>
          ) : (
            <>
              <label className="field">
                {copy("receiptEmail")}
                <input
                  type="email"
                  autoComplete="email"
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                />
              </label>
              {["monthly", "yearly"].map((plan) => (
                <button
                  className="secondary full"
                  key={plan}
                  onClick={async () => {
                    try {
                      await checkout(plan, receiptEmail);
                      setMessage(
                        copy("paymentReturn"),
                      );
                    } catch (e) {
                      setMessage(issueMessage(e));
                    }
                  }}
                >
                  {plan === "monthly" ? copy("monthPlan") : copy("yearPlan")}
                  {bill?.prices?.[plan] ? " В· " + bill.prices[plan] + " в‚Ѕ" : ""}
                </button>
              ))}
              <button className="primary full" onClick={loadBill}>
                {copy("checkPayment")}
              </button>
              <details>
                <summary>{copy("restoreAccess")}</summary>
                <p className="hint">
                  {copy("restoreHint")}
                </p>
                <button
                  className="text-button full"
                  onClick={async () =>
                    setDisplayKey((await recoveryKey()) || "")
                  }
                >
                  {copy("showRecoveryKey")}
                </button>
                {displayKey && (
                  <input
                    type="text"
                    readOnly
                    value={displayKey}
                    aria-label={copy("recoveryKeyLabel")}
                    onFocus={(e) => e.target.select()}
                  />
                )}
                <label className="field">
                  {copy("oldDeviceKey")}
                  <input
                    type="password"
                    autoComplete="off"
                    value={restoreCode}
                    onChange={(e) => setRestoreCode(e.target.value)}
                  />
                </label>
                <button
                  className="secondary full"
                  onClick={async () => {
                    try {
                      setBill(await restoreKey(restoreCode));
                      setRestoreCode("");
                    } catch (e) {
                      setMessage(issueMessage(e));
                    }
                  }}
                >
                  {copy("restoreAccessButton")}
                </button>
              </details>
              <p className="hint">
                {copy("prepaidNote")}
              </p>
            </>
          )}
        </Modal>
      )}
      {modal === "instructions" && (
        <Modal title={copy("instructions")} closeLabel={copy("close")} onClose={() => setModal("settings")}>
          <p>{copy("tutorialText")}</p>
          <p className="hint">{copy("longPress")}</p>
          <ol className="instructions-list">
            <li>{language === "en" ? "Type or dictate the reminder text." : "Р’РІРµРґРёС‚Рµ РёР»Рё РїСЂРѕРґРёРєС‚СѓР№С‚Рµ С‚РµРєСЃС‚ РЅР°РїРѕРјРёРЅР°РЅРёСЏ."}</li>
            <li>{language === "en" ? "Tap dates to select them; tap Done to save." : "РќР°Р¶РёРјР°Р№С‚Рµ РґР°С‚С‹ РґР»СЏ РІС‹Р±РѕСЂР°, Р·Р°С‚РµРј РЅР°Р¶РјРёС‚Рµ В«Р“РѕС‚РѕРІРѕВ»."}</li>
            <li>{language === "en" ? "Use Settings to choose voice, sound and language." : "Р’ РЅР°СЃС‚СЂРѕР№РєР°С… РјРѕР¶РЅРѕ РІС‹Р±СЂР°С‚СЊ РіРѕР»РѕСЃ, СЃРёРіРЅР°Р» Рё СЏР·С‹Рє."}</li>
          </ol>
        </Modal>
      )}
      {alarm && !modal && (
        <AlarmBox
          event={alarm}
          settings={settings}
          onAck={async (source) => {
            try {
              setState(await acknowledge(alarm.id, source));
            } catch (e) {
              setMessage(issueMessage(e));
            }
          }}
          onSnooze={async () => {
            try {
              setState(await snooze(alarm.id));
            } catch (e) {
              setMessage(issueMessage(e));
            }
          }}
        />
      )}
      {deleteTarget && (
        <Modal
          title={language === "en" ? "Delete reminder" : "РЈРґР°Р»РёС‚СЊ РЅР°РїРѕРјРёРЅР°РЅРёРµ"}
          closeLabel={copy("close")}
          onClose={() => setDeleteTarget(null)}
        >
          <p>{deleteTarget.text}</p>
          <button
            className="secondary full"
            onClick={async () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              try {
                setState(await excludeDate(target, selectedDate));
              } catch (e) {
                setMessage(issueMessage(e));
              }
            }}
          >
            {language === "en" ? "Only this day" : "РўРѕР»СЊРєРѕ СЌС‚РѕС‚ РґРµРЅСЊ"}
          </button>
          <button
            className="primary full"
            onClick={async () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              try {
                setState(await deleteReminder(target.id));
              } catch (e) {
                setMessage(issueMessage(e));
              }
            }}
          >
            {language === "en" ? "All occurrences" : "Р’СЃРµ СЃРѕР±С‹С‚РёСЏ"}
          </button>
        </Modal>
      )}
      {timeTarget && (
        <Modal
          title={language === "en" ? "Change time" : "РР·РјРµРЅРёС‚СЊ РІСЂРµРјСЏ"}
          closeLabel={copy("close")}
          className="time-edit-sheet"
          style={{ "--event-color": stableReminderColor(timeTarget.id, timeTarget.colorIndex) }}
          onClose={() => setTimeTarget(null)}
        >
          <article
            className="reminder event-card event-card-modal"
            style={{ "--event-color": stableReminderColor(timeTarget.id, timeTarget.colorIndex) }}
          >
            <div className="event-card-main">
              <div className="event-card-time">{timeValue}</div>
            </div>
            <h3>{timeTarget.text}</h3>
          </article>
          <TimeWheel value={timeValue} language={language} onChange={setTimeValue} />
          <button
            className="primary full"
            onClick={async () => {
              const target = timeTarget;
              try {
                const schedule = { ...target.schedule };
                if (schedule.kind === "once" && schedule.at) {
                  const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
                  const date = localDate(new Date(schedule.at), tz);
                  schedule.at = new Date(zonedTime(date, timeValue, tz)).toISOString();
                } else {
                  schedule.times = [timeValue, ...(schedule.times || []).slice(1)];
                }
                const candidate = { ...target, schedule };
                const conflicts = findTimeConflicts(candidate, state.reminders);
                if (conflicts.length) {
                  const c = conflicts[0];
                  setMessage(
                    language === "en"
                      ? `Already scheduled at this time: вЂњ${c.text}вЂќ. Choose another time.`
                      : `РќР° СЌС‚Рѕ РІСЂРµРјСЏ СѓР¶Рµ Р·Р°РїР»Р°РЅРёСЂРѕРІР°РЅРѕ: В«${c.text}В». Р’С‹Р±РµСЂРёС‚Рµ РґСЂСѓРіРѕРµ РІСЂРµРјСЏ.`,
                  );
                  return;
                }
                setState(await putReminder(candidate));
                setTimeTarget(null);
              } catch (e) {
                setMessage(issueMessage(e));
              }
            }}
          >
            {language === "en" ? "Save time" : "РЎРѕС…СЂР°РЅРёС‚СЊ РІСЂРµРјСЏ"}
          </button>
        </Modal>
      )}
    </main>
  );
}
