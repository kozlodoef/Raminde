import React, { useEffect, useRef, useState, useMemo } from "react";
import { isNative } from "./lib/native.js";
import { startRecognition } from "./lib/speech.js";
import { finishDictation } from "./lib/finish-dictation.js";
import { primeAudio } from "./lib/alerts.js";
import {
  defaults,
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
  nextOccurrences,
  pad,
} from "./domain/calendar.js";
import {
  COLORS,
  colorFor,
  parseGroup,
  buildGroup,
  monthBounds,
  occurrencesInMonth,
} from "./domain/groups.js";
import { accessActive } from "./domain/access.js";
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
  Modal,
  Toggle,
  EditReminder,
  AlarmBox,
  Icon,
} from "./ReminderControls.jsx";
import "./planner.css";
const uid = () => crypto.randomUUID();
const blank = (index = 0) => ({
  id: uid(),
  text: "",
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
function Calendar({ month, onMonth, dates, onDate, occurrences, color }) {
  const b = monthBounds(month),
    days = Array.from({ length: b.offset + b.days }, (_, i) =>
      i < b.offset ? null : month + "-" + pad(i - b.offset + 1),
    ),
    today = localDate();
  return (
    <section className="month-card" aria-label="Календарь">
      <header>
        <button
          aria-label="Предыдущий месяц"
          className="icon-button"
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <h2>
          {new Intl.DateTimeFormat("ru-RU", {
            month: "long",
            year: "numeric",
          }).format(new Date(month + "-01T12:00:00"))}
        </h2>
        <button
          aria-label="Следующий месяц"
          className="icon-button"
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </header>
      <div className="weekdays">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      <div className="days">
        {days.map((d, i) => {
          if (!d) return <span key={"empty" + i} />;
          const dots = [
            ...new Set(
              occurrences.filter((e) => e.date === d).map((e) => e.color),
            ),
          ];
          return (
            <button
              key={d}
              className={
                "day " +
                (dates.includes(d) ? "selected " : "") +
                (d === today ? "today" : "")
              }
              style={{ "--event": color }}
              aria-label={dateLabel(d)}
              aria-pressed={dates.includes(d)}
              onClick={() => onDate(d)}
            >
              <span>{+d.slice(-2)}</span>
              <span className="date-dots">
                {dots.slice(0, 3).map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
                {dots.length > 3 && <small>+</small>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
export default function App() {
  const [state, setState] = useState(null),
    [activation, setActivation] = useState(0),
    [tab, setTab] = useState("home"),
    [month, setMonth] = useState(localDate().slice(0, 7)),
    [draft, setDraft] = useState(() => cachedDrafts().draft || blank()),
    [queue, setQueue] = useState(() => cachedDrafts().queue || []),
    [voice, setVoice] = useState("idle"),
    [live, setLive] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [perms, setPerms] = useState(null),
    [bill, setBill] = useState(null),
    [name, setName] = useState(""),
    [time, setTime] = useState("09:00"),
    [email, setEmail] = useState(""),
    [key, setKey] = useState(""),
    [editing, setEditing] = useState(null);
  const recording = useRef(),
    draftRef = useRef(draft),
    mounted = useRef(true),
    starting = useRef(false),
    recognitionTask = useRef(null),
    saving = useRef(false);
  draftRef.current = draft;
  useEffect(() => {
    localStorage.setItem("raminde.drafts.v3", JSON.stringify({ draft, queue }));
  }, [draft, queue]);
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
        recording.current?.abort();
        setVoice("idle");
      } else {
        setActivation((n) => n + 1);
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
      recording.current?.abort();
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
  function listen() {
    if (starting.current || recording.current || document.hidden || saving.current) return;
    const task = runListen();
    recognitionTask.current = task;
    return task;
  }
  async function runListen() {
    starting.current = true;
    setVoice("starting");
    setMessage("");
    setLive("");
    try {
      const session = await startRecognition({
        onStart: () => mounted.current && setVoice("listening"),
        onInterim: (t) => mounted.current && setLive(t),
      });
      recording.current = session;
      const text = await session.promise;
      if (!mounted.current) return;
      if (text) {
        setVoice("processing");
        const current = draftRef.current,
          p = parseGroup(text, current.dates);
        const parsed = { ...current, ...p, color: current.color, id: current.id };
        draftRef.current = parsed;
        setDraft(parsed);
        setLive(text);
        return true;
      }
      return false;
    } catch (e) {
      if (mounted.current)
        setMessage(
          e.message.includes("not-allowed")
            ? "Разрешите микрофон. Можно также ввести текст вручную."
            : "Не удалось распознать речь. Нажмите микрофон или введите текст.",
        );
    } finally {
      recording.current = null;
      starting.current = false;
      if (mounted.current) setVoice("idle");
    }
  }
  useEffect(() => {
    if (tab !== "home" || alarm) {
      recording.current?.abort();
      return;
    }
    if (!state?.settings.onboarded || !state.settings.autoListen || modal)
      return;
    const t = setTimeout(listen, 400);
    return () => clearTimeout(t);
  }, [
    tab,
    !!alarm,
    state?.settings.onboarded,
    state?.settings.autoListen,
    activation,
  ]);
  useEffect(() => {
    if (modal) recording.current?.abort();
  }, [modal]);
  const patch = (value) =>
    setDraft((d) => ({
      ...d,
      ...value,
      issues: value.dates
        ? []
        : value.times
          ? (d.issues || []).filter(
              (e) => !e.includes("время") && !e.includes("Во сколько"),
            )
          : value.text
            ? (d.issues || []).filter(
                (e) => !e.includes("о чём") && !e.includes("текст"),
              )
            : d.issues || [],
      schedule: Object.prototype.hasOwnProperty.call(value, "schedule")
        ? value.schedule
        : d.schedule?.kind === "dates"
          ? {
              ...d.schedule,
              dates: value.dates ?? d.dates,
              times: value.times ?? d.times,
            }
          : d.schedule,
    }));
  const pick = (d) => {
    if (
      draftRef.current.schedule &&
      draftRef.current.schedule.kind !== "dates"
    ) {
      setMessage(
        "Для повторяющейся серии изменяйте правило в «Повторении». Для отдельных дат начните новый черновик.",
      );
      return;
    }
    patch({
      dates: draft.dates.includes(d)
        ? draft.dates.filter((x) => x !== d)
        : [...draft.dates, d].sort(),
      dateConflict: null,
    });
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
      ...entries,
      ...occurrencesInMonth([...queue, ...(preview ? [preview] : [])], month),
    ],
    [entries, queue, preview, month],
  );
  const setting = async (p) => {
    try {
      setState(await setSettings({ ...state.settings, ...p }));
    } catch (e) {
      setMessage(e.message);
    }
  };
  function newDraft() {
    recording.current?.abort();
    setDraft(blank((state?.reminders.length || 0) + queue.length + 1));
    setLive("");
    setEditing(null);
  }
  function add() {
    try {
      const r = buildGroup(draft, Date.now(), {
        allowPast: state?.reminders.some((r) => r.id === draft.id),
      });
      setQueue((q) => [...q, r]);
      newDraft();
      setMessage("Добавлено в черновики. «Готово» сохранит все.");
      setTimeout(listen, 100);
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function persist(r) {
    let token;
    try {
      if (billingConfigured) token = (await reserveQuota(r.id)).token;
      const s = await putReminder(r, { reservation: token });
      const stored = s?.reminders?.find((item) => item.id === r.id);
      if (!stored || stored.enabled === false || !(Number(stored.nextTriggerAt) > Date.now()))
        throw Error("Не удалось подтвердить сохранение и постановку сигнала. Напоминание осталось в черновике.");
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
    saving.current = true;
    setBusy(true);
    try {
      if (starting.current || recording.current) {
        const recognized = await finishDictation({
          task: recognitionTask.current,
          session: () => recording.current,
        });
        if (!recognized) throw Error("Речь не распознана. Повторите диктовку или введите напоминание вручную.");
      }
      const current = draftRef.current;
      const batch = [
        ...queue,
        ...(current.text.trim()
          ? [
              buildGroup(current, Date.now(), {
                allowPast: state?.reminders.some((r) => r.id === current.id),
              }),
            ]
          : []),
      ];
      if (!batch.length) throw Error("Добавьте событие и время");
      for (const r of batch)
        buildGroup(r, Date.now(), {
          allowPast: state.reminders.some((x) => x.id === r.id),
        });
      for (const r of batch) {
        await persist(r);
        setQueue((q) => q.filter((x) => x.id !== r.id));
        if (r.id === current.id) {
          const fresh = blank((state?.reminders.length || 0) + batch.length);
          draftRef.current = fresh;
          setDraft(fresh);
          setLive("");
        }
      }
      setMessage(`Сохранено групп: ${batch.length}`);
      setEditing(null);
      setModal("saved");
    } catch (e) {
      setMessage(
        e.message === "SUBSCRIPTION"
          ? "Пробный месяц закончился. Нужна подписка."
          : e.message,
      );
      setModal(e.message === "SUBSCRIPTION" ? "access" : "saveError");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function editRule(r) {
    recording.current?.abort();
    setDraft({
      ...r,
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
    setLive(r.originalTranscript || "");
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
  const dates = draft.dates.length ? draft.dates : [localDate()];
  const trial = bill?.trialEndsAt || state.access?.trialEndsAt,
    active = bill ? bill.active : accessActive(state.access);
  const daysLeft = Math.max(0, Math.ceil((trial - Date.now()) / 86400000));
  const eventDates = [...new Set(entries.map((e) => e.date))];
  return (
    <main className={"planner" + (tab === "home" ? " home-screen" : "")}>
      <div className="planner-content">
        {message && (
          <div className="planner-notice" role="status">
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
          <div className="home-layout">
            <section className="voice-card">
              <header>
                <span
                  className={
                    "voice-status " +
                    (["listening", "starting"].includes(voice) ? "live" : "")
                  }
                >
                  <i />
                  {voice === "listening"
                    ? "Слушаю"
                    : voice === "starting"
                      ? "Включаю микрофон…"
                      : voice === "processing"
                        ? "Разбираю…"
                        : editing
                          ? "Редактирование"
                          : "Черновик напоминания"}
                </span>
                <button
                  className="icon-button mic-small"
                  aria-label={
                    ["listening", "starting"].includes(voice)
                      ? "Остановить запись"
                      : "Начать диктовку"
                  }
                  onClick={() =>
                    ["listening", "starting"].includes(voice)
                      ? recording.current?.stop()
                      : listen()
                  }
                >
                  <Icon
                    name={
                      ["listening", "starting"].includes(voice) ? "stop" : "mic"
                    }
                  />
                </button>
              </header>
              {live && (
                <button
                  className="transcript"
                  aria-label="Полная расшифровка"
                  onClick={() => setModal("transcript")}
                  aria-live="polite"
                >
                  «{live}»
                </button>
              )}
              <label className="sr-only" htmlFor="event-text">
                О чём напомнить
              </label>
              <textarea
                id="event-text"
                className="event-text"
                rows={draft.text && draft.text.length < 30 ? 1 : 2}
                value={draft.text}
                placeholder="Скажите, что и когда напомнить…"
                onChange={(e) => patch({ text: e.target.value })}
              />
              <div className="time-chips">
                {draft.times.map((t) => (
                  <button
                    key={t}
                    className="time-chip"
                    aria-label={"Удалить время " + t}
                    onClick={() => {
                      const times = draft.times.filter((x) => x !== t);
                      patch({
                        times,
                        schedule:
                          draft.schedule?.kind === "calendar"
                            ? { ...draft.schedule, times }
                            : draft.schedule,
                      });
                    }}
                  >
                    {t}
                    <span>×</span>
                  </button>
                ))}
              </div>
              <p className="draft-caption">
                {draft.schedule && draft.schedule.kind !== "dates"
                  ? describe(draft.schedule)
                  : draft.dates.length
                    ? `${draft.dates.length} дат · ${draft.times.length} времён · ${draft.dates.length * draft.times.length} срабатываний`
                    : "По умолчанию — сегодня."}
              </p>
              {draft.dateConflict && (
                <div className="date-conflict" role="alert">
                  <p>Названные даты отличаются от выбранных.</p>
                  <button
                    className="text-button"
                    onClick={() =>
                      patch({
                        dateConflict: null,
                        ...(draft.dateConflict.recurring
                          ? {
                              schedule: null,
                              dates: draft.dateConflict.calendarDates,
                            }
                          : {}),
                      })
                    }
                  >
                    Оставить календарь
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (draft.dateConflict.recurring)
                        patch({ dates: [], dateConflict: null });
                      else
                        patch({
                          dates: [draft.dateConflict.spokenDate],
                          schedule: draft.dateConflict.spokenSchedule || null,
                          dateConflict: null,
                        });
                    }}
                  >
                    Использовать сказанное
                  </button>
                </div>
              )}
              {draft.issues?.length > 0 && (
                <p className="error">{draft.issues.join(". ")}</p>
              )}
              <div className="draft-tools">
                <button
                  className="text-button"
                  onClick={() => setModal("repeat")}
                >
                  Повторение
                </button>
                <button
                  className="text-button"
                  onClick={() => setModal("time")}
                >
                  + Время
                </button>
                <button
                  className="icon-button"
                  aria-label="Очистить черновик"
                  onClick={newDraft}
                >
                  <Icon name="close" size={18} />
                </button>
                <button
                  className="color-swatch"
                  style={{ background: draft.color }}
                  aria-label="Изменить цвет группы"
                  onClick={() =>
                    patch({
                      color:
                        COLORS[
                          (COLORS.indexOf(draft.color) + 1) % COLORS.length
                        ],
                    })
                  }
                />
              </div>
            </section>
            <div className="calendar-pane">
              <Calendar
                month={month}
                onMonth={setMonth}
                dates={
                  draft.schedule && draft.schedule.kind !== "dates"
                    ? []
                    : draft.dates.length || draft.text.trim() || live ? dates : []
                }
                onDate={pick}
                occurrences={marks}
                color={draft.color}
              />
              {draft.dates.length > 0 && (
                <p className="selected-caption">
                  {draft.dates.map(dateLabel).join(" · ")}
                </p>
              )}
              {queue.length > 0 && (
                <div className="queued">
                  <strong>Черновики · {queue.length}</strong>
                  {queue.map((r) => (
                    <div key={r.id}>
                      <i style={{ background: r.color }} />
                      <span>
                        {r.text} · {r.times.join(", ")}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={"Удалить черновик " + r.text}
                        onClick={() =>
                          setQueue((q) => q.filter((x) => x.id !== r.id))
                        }
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="planner-actions">
                <button
                  className="secondary"
                  disabled={busy || voice !== "idle"}
                  onClick={add}
                >
                  Добавить
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={save}
                >
                  {busy ? "Сохраняю…" : "Готово"}
                </button>
              </div>
            </div>
          </div>
        )}
        {tab === "events" && (
          <section className="agenda">
            <header className="page-title">
              <h1>События</h1>
              <button
                className="text-button"
                onClick={() => {
                  newDraft();
                  setTab("home");
                }}
              >
                + Добавить
              </button>
            </header>
            <div className="agenda-month">
              <button
                className="icon-button"
                aria-label="Предыдущий месяц"
                onClick={() => setMonth(shiftMonth(month, -1))}
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
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                ›
              </button>
            </div>
            {!entries.length && (
              <div className="empty-agenda">
                <Icon name="bell" size={32} />
                <h2>Месяц без событий</h2>
                <p>Выберите даты и продиктуйте напоминание на главной.</p>
              </div>
            )}
            {eventDates.map((d) => (
              <section className="agenda-day" key={d}>
                <h2>
                  {dateLabel(d)}
                  {d === localDate() ? " · Сегодня" : ""}
                </h2>
                {entries
                  .filter((e) => e.date === d)
                  .map((e) => (
                    <button
                      key={e.id}
                      className={
                        "agenda-event " + (e.at < Date.now() ? "past" : "")
                      }
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
            {state.reminders.some((r) => !r.enabled) && (
              <details className="paused">
                <summary>Отключённые и завершённые группы</summary>
                {state.reminders
                  .filter((r) => !r.enabled)
                  .map((r) => (
                    <button
                      className="agenda-event"
                      key={r.id}
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
            </header>
            <div className="settings-card">
              <label className="field">
                Как обращаться
                <input
                  value={settings.name}
                  onChange={(e) => setting({ name: e.target.value })}
                />
              </label>
              <Toggle
                label="Слушать при открытии"
                description="Только на главной, пока приложение открыто."
                value={settings.autoListen}
                onChange={(v) => setting({ autoListen: v })}
              />
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
                  ? "Подписка активна"
                  : active
                    ? `Первый месяц бесплатно · осталось ${daysLeft} дн.`
                    : "Пробный месяц завершён"}
              </p>
              <p className="hint">
                Без ограничения числа напоминаний. После пробного месяца
                создание и изменение — по подписке. Сохранённые напоминания
                продолжают работать.
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
      <nav className="tab-bar" aria-label="Основная навигация">
        {[
          ["home", "Главная"],
          ["events", "События"],
          ["settings", "Настройки"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setMessage("");
            }}
          >
            <NavIcon name={id} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal === "welcome" && (
        <Modal title="Говорите — мы напомним">
          <p>
            Главная страница может сразу включать микрофон. Запись видна на
            экране и прекращается при выходе из приложения. Аудио обрабатывается
            системным речевым сервисом, который может использовать интернет.
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
              if (settings.autoListen) setTimeout(listen, 450);
            }}
          >
            Начать
          </button>
        </Modal>
      )}
      {modal === "saved" && (
        <Modal title="Напоминания сохранены" onClose={() => setModal(null)}>
          <p>{message}. Сигналы поставлены в расписание. Цвет сохранённой группы не меняется при создании новой.</p>
          <button className="primary full" onClick={() => { setModal(null); setTab("events"); }}>Открыть события</button>
          <button className="secondary full" onClick={() => { setModal(null); if (settings.autoListen) setTimeout(listen, 100); }}>Новое напоминание</button>
        </Modal>
      )}
      {modal === "saveError" && (
        <Modal title="Напоминание не сохранено" onClose={() => setModal(null)}>
          <p role="alert">{message}</p>
          <p className="hint">Текст и выбранные даты остались в черновике. Пока сохранение не подтверждено, сигнал не поставлен.</p>
          {isNative() && /Разрешите/.test(message) && <button className="secondary full" onClick={async () => { try { setPerms(await requestPermissions()); } catch (e) { setMessage(e.message); } }}>Проверить разрешения</button>}
          <button className="primary full" onClick={() => setModal(null)}>Вернуться к черновику</button>
        </Modal>
      )}
      {modal === "transcript" && (
        <Modal title="Расшифровка" onClose={() => setModal(null)}>
          <p>{live || draft.originalTranscript}</p>
        </Modal>
      )}
      {modal === "time" && (
        <Modal title="Добавить время" onClose={() => setModal(null)}>
          <label className="field">
            Время напоминания
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <button
            className="primary full"
            onClick={() => {
              if (!time) return;
              const times = [...new Set([...draft.times, time])].sort();
              patch({
                times,
                schedule:
                  draft.schedule?.kind === "calendar"
                    ? { ...draft.schedule, times }
                    : draft.schedule,
              });
              setModal(null);
            }}
          >
            Добавить время
          </button>
        </Modal>
      )}
      {modal === "repeat" && (
        <EditReminder
          initial={{
            ...draft,
            schedule:
              draft.schedule && draft.schedule.kind !== "dates"
                ? draft.schedule
                : {
                    ...defaultSchedule(),
                    kind: "calendar",
                    times: draft.times.length ? draft.times : ["09:00"],
                    anchorDate: dates[0],
                  },
          }}
          settings={settings}
          busy={false}
          onClose={() => setModal(null)}
          onSave={async (r) => {
            setDraft({
              ...r,
              dates: [],
              times: r.schedule.times || [],
              issues: [],
              dateConflict: null,
            });
            setModal(null);
          }}
        />
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
