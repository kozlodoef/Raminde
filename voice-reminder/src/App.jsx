import { eventCardStyle } from "./lib/event-colors.js";
import {
  editorPhrase,
  parseEditor,
  toggleEditorDate,
  sessionGate,
} from "./domain/home-editor.js";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { isNative } from "./lib/native.js";
import { startContinuousDictation } from "./lib/continuous-dictation.js";
import { finishDictation } from "./lib/finish-dictation.js";
import { primeAudio, playRecordingCue, playDictationDoneCue } from "./lib/alerts.js";
import Calendar from "./PlannerCalendar.jsx";
import { assertDailyCapacity } from "./domain/day-capacity.js";
import {
  getState,
  setSettings,
  putReminder,
  deleteReminder,
  acknowledge,
  snooze,
  skipOccurrence,
  fireWeb,
  permissions,
  requestPermissions,
  speakName,
} from "./domain/repository.js";
import {
  localDate,
  defaultSchedule,
  describe,
  shortTime,
  pad,
} from "./domain/calendar.js";
import {
  COLORS,
  colorFor,
  buildGroup,
  occurrencesInMonth,
} from "./domain/groups.js";
import { accessActive, proActive, FREE_REMINDER_LIMIT, FREE_REPEAT_LIMIT } from "./domain/access.js";
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
import { Modal, Toggle, AlarmBox, Icon } from "./ReminderControls.jsx";
import "./planner.css";
const uid = () => crypto.randomUUID();
const eventCount = (n) =>
  `${n} ${new Intl.PluralRules("ru").select(n) === "one" ? "событие" : new Intl.PluralRules("ru").select(n) === "few" ? "события" : "событий"}`;
const blank = (index = 0) => ({
  id: uid(),
  text: "",
  phrase: "",
  selectedDates: [],
  dates: [],
  times: [],
  color: COLORS[index % COLORS.length],
  issues: [],
});
function cachedDrafts() {
  try {
    return JSON.parse(localStorage.getItem("raminde.drafts.v3") || "{}");
  } catch {
    return {};
  }
}
const dateLabel = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(d + "T12:00:00"),
  );
function shiftMonth(m, step) {
  const [y, n] = m.split("-").map(Number),
    d = new Date(y, n - 1 + step, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
function NavIcon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="23"
      height="23"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path
        d={
          name === "home"
            ? "M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10"
            : name === "events"
              ? "M5 4h14v17H5ZM8 2v5M16 2v5M5 9h14M8 13h3M8 17h7"
              : "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z"
        }
      />
    </svg>
  );
}
export default function App() {
  const [state, setState] = useState(null),
    [tab, setTab] = useState("home"),
    [month, setMonth] = useState(localDate().slice(0, 7)),
    [draft, setDraft] = useState(() => cachedDrafts().draft || blank()),
    [creating, setCreating] = useState(false),
    [voice, setVoice] = useState("idle"),
    [live, setLive] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [perms, setPerms] = useState(null),
    [bill, setBill] = useState(null),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [key, setKey] = useState(""),
    [editing, setEditing] = useState(null),
    [dayFilter, setDayFilter] = useState(null);
  const recording = useRef(),
    draftRef = useRef(draft),
    mounted = useRef(true),
    starting = useRef(false),
    recognitionTask = useRef(null),
    saving = useRef(false),
    gate = useRef(sessionGate()),
    parsedTranscript = useRef("");
  draftRef.current = draft;
  useEffect(() => {
    const legacy = cachedDrafts();
    if (
      legacy.queue?.length &&
      !localStorage.getItem("raminde.drafts.legacy-backup")
    )
      localStorage.setItem(
        "raminde.drafts.legacy-backup",
        JSON.stringify(legacy),
      );
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 8000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    localStorage.setItem("raminde.drafts.v3", JSON.stringify({ draft }));
  }, [draft]);
  const refresh = async () => {
    if (saving.current) return;
    try {
      const s = await (isNative() ? getState() : fireWeb());
      if (mounted.current && !saving.current) setState(s);
    } catch (e) {
      if (mounted.current) setMessage(e.message);
    }
  };
  useEffect(() => {
    mounted.current = true;
    primeAudio();
    refresh();
    permissions()
      .then(setPerms)
      .catch(() => {});
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 1500);
    const visible = () => {
      if (document.hidden) {
        cancelRecording();
        setCreating(false);
      } else {
        refresh();
        permissions()
          .then(setPerms)
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      clearInterval(id);
      cancelRecording();
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (state) document.documentElement.dataset.theme = state.settings.theme;
  }, [state?.settings.theme]);
  useEffect(() => {
    if (state && !state.settings.onboarded) setModal("welcome");
  }, [!!state]);
  useEffect(() => {
    if (billingConfigured && state)
      billingStatus()
        .then(setBill)
        .catch((e) => setMessage(e.message));
  }, [!!state]);
  const alarm = state?.events.find((e) =>
    ["ringing", "waiting"].includes(e.state),
  );
  function cancelRecording() {
    gate.current.next();
    const old = recording.current;
    recording.current = null;
    starting.current = false;
    recognitionTask.current = null;
    old?.abort();
    if (mounted.current) setVoice("idle");
  }
  function listen() {
    if (
      starting.current ||
      recording.current ||
      document.hidden ||
      saving.current
    )
      return;
    setCreating(true);
    const token = gate.current.next();
    const task = runListen(token);
    recognitionTask.current = task;
    return task;
  }
  async function runListen(token) {
    const valid = () => mounted.current && gate.current.valid(token);
    starting.current = true;
    setVoice("starting");
    setLive("");
    setMessage("");
    try {
      if (!isNative()) await playRecordingCue();
      if (!valid()) return false;
      parsedTranscript.current = "";
      const applyTranscript = (text) => {
        if (!valid() || !text || parsedTranscript.current === text) return;
        parsedTranscript.current = text;
        const parsed = parseEditor(text, draftRef.current);
        draftRef.current = parsed;
        setDraft(parsed);
        setLive(text);
      };
      const session = startContinuousDictation({
        restartOnEnd: !isNative(),
        onStart: () => valid() && setVoice("listening"),
        onWaiting: () => valid() && setVoice("listening"),
        onInterim: (text) => valid() && setLive(text),
        onFinal: applyTranscript,
      });
      recording.current = session;
      const text = await session.promise;
      if (!valid()) return false;
      if (text) {
        applyTranscript(text);
        return true;
      }
      return false;
    } catch (e) {
      if (valid())
        setMessage(
          e.message.includes("not-allowed")
            ? "Разрешите доступ к микрофону в настройках телефона. Или напечатайте напоминание."
            : "Не удалось распознать речь. Нажмите «Начать» ещё раз или напечатайте текст.",
        );
      return false;
    } finally {
      if (valid()) {
        recording.current = null;
        starting.current = false;
        setVoice("idle");
        if (!saving.current) setCreating(false);
      }
    }
  }
  // Never auto-start, including upgrades with the old autoListen preference enabled.
  useEffect(() => {
    if (alarm) {
      cancelRecording();
      setCreating(false);
    }
  }, [!!alarm]);
  function typePhrase(phrase) {
    const next = parseEditor(phrase, draftRef.current);
    draftRef.current = next;
    setDraft(next);
    setLive("");
    setCreating(!!phrase.trim());
    setMessage("");
  }
  const pick = (date) => {
    const next = toggleEditorDate(draftRef.current, date);
    draftRef.current = next;
    setDraft(next);
    setMessage("");
  };
  const remindersKey = JSON.stringify([
    state?.reminders || [],
    state?.events || [],
  ]);
  const entries = useMemo(() => {
    const list = occurrencesInMonth(state?.reminders || [], month);
    for (const e of state?.events || []) {
      const date = localDate(new Date(e.scheduledAt));
      if (!date.startsWith(month)) continue;
      const existing = list.find((v) => v.id === e.id);
      if (existing) {
        existing.status = e.state;
        continue;
      }
      const index = state.reminders.findIndex((r) => r.id === e.reminderId),
        rule = state.reminders[index];
      list.push({
        id: e.id,
        reminderId: e.reminderId,
        text: e.text,
        at: e.scheduledAt,
        date,
        time: shortTime(e.scheduledAt),
        color: colorFor(rule || {}, Math.max(0, index)),
        status: e.state,
      });
    }
    return list.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text));
  }, [remindersKey, month]);
  const preview = useMemo(() => {
    try {
      return buildGroup(draft, Date.now(), {
        allowPast: state?.reminders.some((r) => r.id === draft.id),
      });
    } catch {
      return null;
    }
  }, [draft]);
  const marks = useMemo(
    () => [
      ...entries.filter(
        (e) => !creating || !preview || e.reminderId !== preview.id,
      ),
      ...occurrencesInMonth(preview && creating ? [preview] : [], month),
    ],
    [entries, preview, month, creating],
  );
  const setting = async (p) => {
    try {
      setState(await setSettings({ ...state.settings, ...p }));
    } catch (e) {
      setMessage(e.message);
    }
  };
  function newDraft() {
    if (saving.current) return;
    cancelRecording();
    const fresh = blank(state?.reminders.length || 0);
    draftRef.current = fresh;
    setDraft(fresh);
    setCreating(false);
    setMessage("");
    setLive("");
    setEditing(null);
  }
  async function persist(r) {
    let token;
    const pro = bill ? !!bill.premium : proActive(state.access);
    try {
      if (billingConfigured && pro) token = (await reserveQuota(r.id)).token;
      const s = await putReminder(r, { reservation: token });
      const stored = s?.reminders?.find((item) => item.id === r.id);
      if (
        !stored ||
        stored.enabled === false ||
        !(Number(stored.nextTriggerAt) > Date.now())
      )
        throw Error(
          "Не удалось подтвердить сохранение и постановку сигнала. Напоминание осталось в черновике.",
        );
      setState(s);
      if (token)
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
    } catch (e) {
      if (token) await releaseQuota(token).catch(() => {});
      throw e;
    }
  }
  async function save() {
    if (saving.current) return;
    document.activeElement?.blur?.();
    saving.current = true;
    setBusy(true);
    try {
      if (starting.current || recording.current) {
        const recognized = await finishDictation({
          task: recognitionTask.current,
          session: () => recording.current,
        });
        if (!isNative()) await playDictationDoneCue();
        if (!recognized && !draftRef.current.text?.trim())
          throw Error(
            "Речь не распознана. Нажмите «Начать» или напечатайте напоминание.",
          );
      }
      const current = draftRef.current;
      const rule = buildGroup(current, Date.now(), {
        allowPast: state?.reminders.some((r) => r.id === current.id),
      });
      if (!isPro) {
        const isNew = !state.reminders.some((r) => r.id === rule.id);
        // Лимит считается по активным напоминаниям: удалённые/отключённые
        // слоты переиспользуются.
        const activeCount = state.reminders.filter(
          (r) => r.enabled !== false,
        ).length;
        if (isNew && activeCount >= FREE_REMINDER_LIMIT) throw Error("FREE_LIMIT");
        const times =
          rule.schedule?.times?.length ||
          (rule.schedule?.kind === "once" ? 1 : 0);
        const isRepeating =
          ["repeat", "calendar", "interval"].includes(rule.schedule?.kind) ||
          times > FREE_REPEAT_LIMIT;
        if (isRepeating) throw Error("FREE_PRO_ONLY");
      }
      assertDailyCapacity(state.reminders, [rule], { events: state.events });
      await persist(rule);
      const fresh = blank(
        state.reminders.length +
          (state.reminders.some((r) => r.id === rule.id) ? 0 : 1),
      );
      draftRef.current = fresh;
      setDraft(fresh);
      setLive("");
      setCreating(false);
      setMessage("Напоминание сохранено. " + describe(rule.schedule));
      setEditing(null);
    } catch (e) {
      setCreating(false);
      setMessage(
        e.message === "SUBSCRIPTION"
          ? "Пробный месяц закончился. Нужна подписка."
          : e.message === "FREE_LIMIT"
            ? `В бесплатной версии до ${FREE_REMINDER_LIMIT} напоминаний. Удалите одно или оформите PRO.`
            : e.message === "FREE_PRO_ONLY"
              ? "Повторяющиеся напоминания доступны в версии PRO."
              : e.message,
      );
      if (
        e.message === "SUBSCRIPTION" ||
        e.message === "FREE_LIMIT" ||
        e.message === "FREE_PRO_ONLY"
      )
        setModal("access");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function editRule(r) {
    if (recording.current || starting.current) {
      setMessage("Сначала завершите диктовку кнопкой «Готово».");
      return;
    }
    recording.current?.abort();
    setCreating(true);
    setDraft({
      ...r,
      phrase: editorPhrase(r),
      dates:
        r.schedule.kind === "dates"
          ? r.schedule.dates
          : r.schedule.kind === "once"
            ? [localDate(new Date(r.schedule.at))]
            : [],
      times:
        r.schedule.kind === "once"
          ? [shortTime(r.schedule.at)]
          : r.schedule.times || [],
      schedule: r.schedule.kind === "once" ? null : r.schedule,
      issues: [],
      dateConflict: null,
    });
    setLive("");
    setEditing(r.id);
    setTab("home");
    if (r.schedule.kind === "dates") setMonth(r.schedule.dates[0].slice(0, 7));
  }
  if (!state)
    return (
      <main className={"planner" + (tab === "home" ? " home-screen" : "")}>
        <p>Загружаю Remind me…</p>
        {message && <p className="error">{message}</p>}
      </main>
    );
  const settings = state.settings;
  const voiceActive = voice !== "idle";
  const composing = creating || voiceActive;
  const dates = draft.dates;
  const trial = bill?.trialEndsAt || state.access?.trialEndsAt,
    active = bill ? bill.active : accessActive(state.access);
  const isPro = bill ? !!bill.premium : proActive(state.access);
  const daysLeft = Math.max(0, Math.ceil((trial - Date.now()) / 86400000));
  const shownEntries = dayFilter
    ? entries.filter((e) => e.date === dayFilter)
    : entries;
  const eventDates = [...new Set(shownEntries.map((e) => e.date))];
  return (
    <main className={"planner" + (tab === "home" ? " home-screen" : "")}>
      <div className="planner-content">
        {message && (
          <div className="floating-bubble" role="status" aria-live="polite">
            <span>{message}</span>
            <button
              className="icon-button"
              aria-label="Скрыть сообщение"
              onClick={() => setMessage("")}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {tab === "home" && (
          <div className="focus-home">
            <header className="focus-header">
              <span className="brand-wordmark" aria-label="Remind me">
                remind me<span>.</span>
              </span>
              <button
                className="icon-button settings-link"
                aria-label="Настройки"
                disabled={voiceActive || busy}
                onClick={() => {
                  setTab("settings");
                  setMessage("");
                }}
              >
                <NavIcon name="settings" />
              </button>
            </header>
            <section className="focus-editor" aria-label="Напоминание">
              <button
                className="icon-button clear-editor"
                aria-label="Очистить напоминание"
                disabled={busy}
                onClick={newDraft}
              >
                <Icon name="close" />
              </button>
              <label className="sr-only" htmlFor="event-text">
                Текст напоминания и время
              </label>
              <textarea
                id="event-text"
                value={voiceActive && live ? live : editorPhrase(draft)}
                readOnly={voiceActive || busy}
                spellCheck="true"
                placeholder="Сообщите, о чём напомнить и во сколько. Затем выберите даты на календаре и нажмите «Готово»."
                onChange={(e) => typePhrase(e.target.value)}
              />
            </section>
            <button
              className={
                "focus-record " + (composing ? "is-recording" : "is-ready")
              }
              disabled={busy}
              aria-pressed={voiceActive}
              aria-label={busy ? "Сохраняю" : composing ? "Готово" : "Начать"}
              onClick={composing ? save : listen}
            >
              <span className="record-symbol" aria-hidden="true">
                {composing ? "✓" : "●"}
              </span>
              {busy ? "Сохраняю…" : composing ? "Готово" : "Начать"}
            </button>
            <Calendar
              month={month}
              onMonth={setMonth}
              selecting={composing}
              dates={composing ? dates : []}
              draftId={draft.id}
              occurrences={marks}
              color={draft.color}
              onDate={(date) => {
                if (busy) return;
                if (composing) pick(date);
                else {
                  setDayFilter(date);
                  setTab("events");
                  setMessage("");
                }
              }}
            />
          </div>
        )}
        {tab === "events" && (
          <section className="agenda">
            <header className="page-title">
              <h1>События</h1>
              <button
                className="text-button back-home"
                onClick={() => {
                  setTab("home");
                  setMessage("");
                }}
              >
                ← Главная
              </button>
            </header>
            <div className="agenda-month">
              <button
                className="icon-button"
                aria-label="Предыдущий месяц"
                onClick={() => {
                  setDayFilter(null);
                  setMonth(shiftMonth(month, -1));
                }}
              >
                ‹
              </button>
              <span>
                {new Intl.DateTimeFormat("ru-RU", {
                  month: "long",
                  year: "numeric",
                }).format(new Date(month + "-01T12:00:00"))}
              </span>
              <button
                className="icon-button"
                aria-label="Следующий месяц"
                onClick={() => {
                  setDayFilter(null);
                  setMonth(shiftMonth(month, 1));
                }}
              >
                ›
              </button>
            </div>
            {dayFilter && (
              <div className="day-filter">
                <strong>
                  {dateLabel(dayFilter)} · {eventCount(shownEntries.length)}
                </strong>
                <button
                  className="text-button"
                  onClick={() => setDayFilter(null)}
                >
                  Весь месяц
                </button>
              </div>
            )}
            {!shownEntries.length && (
              <div className="empty-agenda">
                <Icon name="bell" size={32} />
                <h2>
                  {dayFilter ? "В этот день нет событий" : "Месяц без событий"}
                </h2>
                <p>
                  Вернитесь на главную, нажмите «Начать» и выберите этот день.
                </p>
              </div>
            )}
            {eventDates.map((d) => (
              <section className="agenda-day" key={d}>
                <h2>
                  {dateLabel(d)}
                  {d === localDate() ? " · Сегодня" : ""}
                </h2>
                {shownEntries
                  .filter((e) => e.date === d)
                  .map((e) => (
                    <button
                      key={e.id}
                      className={
                        "agenda-event " + (e.at < Date.now() ? "past" : "")
                      }
                      style={eventCardStyle(e.color)}
                      onClick={() => {
                        const r = state.reminders.find(
                          (r) => r.id === e.reminderId,
                        );
                        setEditing({ rule: r, event: e });
                        setModal("event");
                      }}
                    >
                      <i style={{ background: e.color }} />
                      <time>{e.time}</time>
                      <span>{e.text}</span>
                      <span className="chevron">›</span>
                    </button>
                  ))}
              </section>
            ))}
            {!dayFilter && state.reminders.some((r) => !r.enabled) && (
              <details className="paused">
                <summary>Отключённые и завершённые группы</summary>
                {state.reminders
                  .filter((r) => !r.enabled)
                  .map((r) => (
                    <button
                      className="agenda-event"
                      key={r.id}
                      style={eventCardStyle(colorFor(r))}
                      onClick={() => {
                        setEditing({ rule: r });
                        setModal("event");
                      }}
                    >
                      <i style={{ background: colorFor(r) }} />
                      <span>{r.text}</span>
                      <span>›</span>
                    </button>
                  ))}
              </details>
            )}
          </section>
        )}
        {tab === "settings" && (
          <section className="planner-settings">
            <header className="page-title">
              <h1>Настройки</h1>
              <button
                className="text-button back-home"
                onClick={() => {
                  setTab("home");
                  setMessage("");
                }}
              >
                ← Главная
              </button>
            </header>
            <div className="settings-card">
              <label className="field">
                Как обращаться
                <input
                  value={settings.name}
                  onChange={(e) => setting({ name: e.target.value })}
                />
              </label>
              <label className="field">
                Как напоминать
                <select
                  value={settings.mode}
                  onChange={(e) => setting({ mode: e.target.value })}
                >
                  <option value="voiceAndNotification">
                    Голосом и уведомлением
                  </option>
                  <option value="voice">Голосом</option>
                  <option value="notification">Только уведомлением</option>
                </select>
              </label>
              <Toggle
                label="Звук уведомления"
                value={settings.sound}
                onChange={(v) => setting({ sound: v })}
              />
              <Toggle
                label="Вибрация"
                value={settings.vibration}
                onChange={(v) => setting({ vibration: v })}
              />
              <Toggle
                label="Напоминать до реакции"
                value={settings.repeat}
                onChange={(v) => setting({ repeat: v })}
              />
              {settings.repeat && (
                <>
                  <label className="field">
                    Интервал повторов, минут
                    <input
                      type="number"
                      min="1"
                      value={settings.repeatMinutes}
                      onChange={(e) =>
                        +e.target.value > 0 &&
                        setting({ repeatMinutes: +e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Максимум попыток, 0 — без ограничения
                    <input
                      type="number"
                      min="0"
                      value={settings.maxAttempts}
                      onChange={(e) =>
                        setting({ maxAttempts: Math.max(0, +e.target.value) })
                      }
                    />
                  </label>
                </>
              )}
              <Toggle
                label="Ответ голосом"
                description="По нажатию кнопки на экране напоминания."
                value={settings.voiceAck}
                onChange={(v) => setting({ voiceAck: v })}
              />
              <label className="field">
                Слова подтверждения
                <input
                  value={settings.keywords}
                  onChange={(e) => setting({ keywords: e.target.value })}
                />
              </label>
              <Toggle
                label="Скрывать текст на блокировке"
                value={settings.privateNotification}
                onChange={(v) => setting({ privateNotification: v })}
              />
              <label className="field">
                Тема
                <select
                  value={settings.theme}
                  onChange={(e) => setting({ theme: e.target.value })}
                >
                  <option value="system">Как на устройстве</option>
                  <option value="light">Светлая</option>
                  <option value="dark">Тёмная</option>
                </select>
              </label>
            </div>
            <div className="settings-card">
              <h2>Доступ</h2>
              <p>
                {bill?.premium
                  ? "PRO активна"
                  : active && trial > Date.now()
                    ? `Пробный период PRO · осталось ${daysLeft} дн.`
                    : `Бесплатная версия · ${Math.min(state.reminders.length, FREE_REMINDER_LIMIT)}/${FREE_REMINDER_LIMIT} напоминаний`}
              </p>
              <p className="hint">
                Бесплатно — до {FREE_REMINDER_LIMIT} напоминаний без повторов.
                PRO снимает лимиты и открывает повторяющиеся напоминания.
                Сохранённые напоминания продолжают работать всегда.
              </p>
              <button
                className="secondary full"
                onClick={() => setModal("access")}
              >
                Подписка и восстановление
              </button>
            </div>
            <div className="settings-card">
              <h2>Проверка телефона</h2>
              {!isNative() && (
                <p className="hint">
                  Веб-версия — предпросмотр: срабатывания только пока вкладка
                  открыта.
                </p>
              )}
              <p className="hint">
                Уведомления:{" "}
                {{
                  granted: "разрешены",
                  denied: "не разрешены",
                  default: "разрешение не запрошено",
                  unsupported: "не поддерживаются",
                }[perms?.notifications] || "проверяю"}
                .{" "}
                {isNative() &&
                  `Точные будильники: ${perms?.exact ? "разрешены" : "нужно разрешение"}.`}
              </p>
              <button
                className="secondary full"
                onClick={() =>
                  requestPermissions()
                    .then(setPerms)
                    .catch((e) => setMessage(e.message))
                }
              >
                Проверить разрешения
              </button>
              <button
                className="text-button full"
                onClick={() =>
                  speakName(
                    (settings.name ? settings.name + "! " : "") +
                      "Это проверка голоса.",
                  ).catch((e) => setMessage(e.message))
                }
              >
                Послушать голос
              </button>
              {state.errors?.message && (
                <p className="error">{state.errors.message}</p>
              )}
              {state.recovery && (
                <>
                  <h3>После перезагрузки</h3>
                  <p className="hint">Версия: {state.recovery.appVersion}</p>
                  <p className="hint">
                    Сигнал загрузки:{" "}
                    {state.recovery.bootConfirmed
                      ? "получен"
                      : "не зарегистрирован"}
                    .
                  </p>
                  <p className="hint">
                    Последнее восстановление:{" "}
                    {state.recovery.source === "app_resume"
                      ? "при открытии приложения"
                      : state.recovery.source || "—"}
                    . Сигналов: {state.recovery.scheduled || 0}.
                  </p>
                  {state.recovery.bootConfirmed && (
                    <p className="hint">
                      При загрузке:{" "}
                      {state.recovery.bootRestore?.completedAt
                        ? "завершено"
                        : "не завершено"}
                      , сигналов {state.recovery.bootRestore?.scheduled || 0}.
                    </p>
                  )}
                  {state.recovery.error && (
                    <p className="error">{state.recovery.error}</p>
                  )}
                  <p className="hint">
                    На MIUI разрешите фоновый автозапуск и отключите ограничения
                    батареи для этого приложения.
                  </p>
                </>
              )}
            </div>
          </section>
        )}
      </div>
      {modal === "welcome" && (
        <Modal title="Говорите — мы напомним">
          <p>
            Нажмите «Начать», чтобы включить микрофон. «Готово» завершает
            диктовку и сохраняет напоминание. Аудио обрабатывается системным
            речевым сервисом, который может использовать интернет.
          </p>
          <p className="hint">
            Во время создания выбирайте даты на календаре. Чтобы очистить текст,
            нажмите крестик. Вне создания нажатие на дату открывает события дня.
            Не более 12 срабатываний в день. Микрофон сам не включается.
          </p>
          <label className="field">
            Как к вам обращаться
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ваше имя, необязательно"
            />
          </label>
          <p className="hint">
            Первый месяц бесплатно, без ограничений. Без автоматических
            списаний.
          </p>
          <button
            className="primary full"
            onClick={async () => {
              await setting({ name, onboarded: true });
              setModal(null);
            }}
          >
            Начать
          </button>
        </Modal>
      )}
      {draft.dateConflict && !modal && (
        <div className="floating-bubble conflict-bubble" role="alert">
          <p>В тексте и календаре разные даты. Какие использовать?</p>
          <button
            className="secondary"
            onClick={() => {
              const dates =
                draft.dateConflict.calendarDates ||
                draft.dateConflict.selectedDates;
              const next = {
                ...draft,
                dates,
                selectedDates: dates,
                dateConflict: null,
                schedule: {
                  ...defaultSchedule(),
                  kind: "dates",
                  dates,
                  times: draft.times,
                },
              };
              draftRef.current = next;
              setDraft(next);
              setCreating(true);
              setMessage("");
            }}
          >
            Даты календаря
          </button>
          <button
            className="primary"
            onClick={() => {
              const next = parseEditor(editorPhrase(draft), {
                ...draft,
                selectedDates: [],
              });
              draftRef.current = next;
              setDraft(next);
              setCreating(true);
              setMessage("");
            }}
          >
            Даты из текста
          </button>
        </div>
      )}
      {modal === "event" && editing?.rule && (
        <Modal
          title={editing.rule.text}
          onClose={() => {
            setEditing(null);
            setModal(null);
          }}
        >
          <p>{describe(editing.rule.schedule)}</p>
          {editing.event && (
            <p className="hint">
              Выбрано: {dateLabel(editing.event.date)} · {editing.event.time}
            </p>
          )}
          <button
            className="primary full"
            disabled={voiceActive || busy}
            onClick={() => {
              editRule(editing.rule);
              setModal(null);
            }}
          >
            Изменить группу
          </button>
          {editing.event && editing.event.at > Date.now() && (
            <button
              className="secondary full"
              onClick={async () => {
                const r = editing.rule;
                try {
                  setState(await skipOccurrence(r.id, editing.event.at));
                  setModal(null);
                } catch (e) {
                  setMessage(e.message);
                }
              }}
            >
              Пропустить это срабатывание
            </button>
          )}
          <button
            className="secondary full"
            onClick={async () => {
              try {
                if (editing.rule.enabled)
                  setState(
                    await putReminder({ ...editing.rule, enabled: false }),
                  );
                else await persist({ ...editing.rule, enabled: true });
                setModal(null);
              } catch (e) {
                setMessage(e.message);
              }
            }}
          >
            {editing.rule.enabled ? "Приостановить группу" : "Включить группу"}
          </button>
          <button
            className="text-button full danger"
            onClick={() => setModal("delete")}
          >
            Удалить группу
          </button>
        </Modal>
      )}
      {modal === "delete" && editing?.rule && (
        <Modal title="Удалить всю группу?" onClose={() => setModal("event")}>
          <p>Будут отменены все будущие срабатывания «{editing.rule.text}».</p>
          <button
            className="primary full"
            onClick={async () => {
              setState(await deleteReminder(editing.rule.id));
              setModal(null);
              setEditing(null);
            }}
          >
            Удалить
          </button>
        </Modal>
      )}
      {modal === "access" && (
        <Modal title="Первый месяц — бесплатно" onClose={() => setModal(null)}>
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
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {["monthly", "yearly"].map((plan) => (
                <button
                  className="primary full"
                  key={plan}
                  onClick={() =>
                    checkout(plan, email).catch((e) => setMessage(e.message))
                  }
                >
                  {plan === "monthly" ? "Месяц" : "Год"} · {bill.prices[plan]} ₽
                </button>
              ))}
              <button
                className="secondary full"
                onClick={() =>
                  billingStatus()
                    .then(setBill)
                    .catch((e) => setMessage(e.message))
                }
              >
                Проверить оплату
              </button>
            </>
          )}
          {billingConfigured && (
            <>
              <button
                className="text-button full"
                onClick={() => recoveryKey().then(setKey)}
              >
                Показать ключ восстановления
              </button>
              <label className="field">
                Ключ доступа
                <input
                  value={key || ""}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="secondary full"
                onClick={() =>
                  restoreKey(key)
                    .then(setBill)
                    .catch((e) => setMessage(e.message))
                }
              >
                Восстановить доступ
              </button>
            </>
          )}
        </Modal>
      )}
      {alarm && (
        <AlarmBox
          key={alarm.id}
          event={alarm}
          settings={settings}
          onAck={(source) => acknowledge(alarm.id, source).then(setState)}
          onSnooze={() => snooze(alarm.id).then(setState)}
        />
      )}
    </main>
  );
}
