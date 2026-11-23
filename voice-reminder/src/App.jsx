import { eventCardStyle } from "./lib/event-colors.js";
import {
  editorPhrase,
  parseEditor,
  toggleEditorDate,
  sessionGate,
} from "./domain/home-editor.js";
import { toDigits } from "./domain/phrase-digits.js";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { isNative } from "./lib/native.js";
import { startContinuousDictation } from "./lib/continuous-dictation.js";
import { finishDictation } from "./lib/finish-dictation.js";
import { primeAudio, playRecordingCue, playDictationDoneCue } from "./lib/alerts.js";
import { ALERT_CUES, previewCue } from "./lib/alert-cues.js";
import { FONT_STEPS, MIN_FONT } from "./lib/fit-text.js";
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
  requestFullscreen,
  requestBattery,
  requestAutostart,
  speakName,
} from "./domain/repository.js";
import {
  localDate,
  describe,
  shortTime,
} from "./domain/calendar.js";
import {
  colorFor,
  buildGroup,
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
import { Modal, Toggle, AlarmBox, Icon } from "./ReminderControls.jsx";
import NavIcon from "./components/NavIcon.jsx";
import WelcomeModal from "./components/WelcomeModal.jsx";
import DateConflictBubble from "./components/DateConflictBubble.jsx";
import EventModal from "./components/EventModal.jsx";
import DeleteGroupModal from "./components/DeleteGroupModal.jsx";
import AccessModal from "./components/AccessModal.jsx";
import {
  eventCount,
  blank,
  cachedDrafts,
  dateLabel,
  shiftMonth,
} from "./domain/draft-model.js";
import "./planner.css";
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
    [editorFont, setEditorFont] = useState(0),
    [dayFilter, setDayFilter] = useState(null);
  const recording = useRef(),
    draftRef = useRef(draft),
    editorRef = useRef(null),
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
        // Показываем расшифровку цифрами: дату и время человек проверяет
        // глазами, и «25.12 в 19:30» проверяется быстрее, чем словами.
        setLive(toDigits(text, parsed));
      };
      const session = startContinuousDictation({
        restartOnEnd: !isNative(),
        onStart: () => valid() && setVoice("listening"),
        onWaiting: () => valid() && setVoice("listening"),
        // Промежуточная расшифровка тоже цифрами: иначе во время речи
        // мелькали слова, а в конце текст менялся на цифры — выглядело как
        // «подмена». Разбор ещё не готов, поэтому передаём пустой объект.
        onInterim: (text) =>
          valid() && setLive(toDigits(text, draftRef.current || {})),
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
  // Разбор фразы стоит 1,5–4 мс, а на телефоне — в несколько раз дороже.
  // Поэтому текст показывается сразу, а разбор выполняется с небольшой паузой.
  const parseTimer = useRef(null);

  // Подбор размера шрифта под длину фразы.
  //
  // Поле ввода показывает фразу целиком, и длинная фраза при крупном шрифте
  // уезжала за границу — её приходилось прокручивать. Теперь шрифт
  // подбирается так, чтобы текст был виден весь: короткая фраза крупно,
  // длинная мельче. Пересчитываем при смене текста и размера экрана
  // (поворот телефона, появление клавиатуры).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return undefined;
    const fit = () => {
      // Проверяем по реальной вёрстке, а не по оценке: подбираем самый
      // крупный размер, при котором scrollHeight не превышает clientHeight.
      // Так результат совпадает с тем, что видит пользователь, при любом
      // шрифте и любом размере экрана.
      const previous = el.style.fontSize;
      for (const size of FONT_STEPS) {
        el.style.fontSize = size + "px";
        if (el.scrollHeight <= el.clientHeight) {
          setEditorFont(size);
          return;
        }
      }
      // Даже минимальный размер не влезает — оставляем его.
      el.style.fontSize = MIN_FONT + "px";
      setEditorFont(MIN_FONT);
      void previous;
    };
    fit();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(el);
    window.addEventListener("orientationchange", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, [live, draft.phrase, draft.text]);

  function typePhrase(phrase) {
    setLive(phrase);
    setCreating(!!phrase.trim());
    setMessage("");
    if (parseTimer.current) clearTimeout(parseTimer.current);
    parseTimer.current = setTimeout(() => {
      parseTimer.current = null;
      const next = parseEditor(phrase, draftRef.current);
      draftRef.current = next;
      setDraft(next);
      // Показываем фразу цифрами: «двадцать пятого декабря в 19:30»
      // читается и проверяется быстрее, чем «двадцать пятого декабря
      // в половину восьмого вечера». Сырая расшифровка остаётся в
      // originalTranscript и не теряется.
      setLive(toDigits(phrase, next));
    }, 140);
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
    try {
      if (billingConfigured) token = (await reserveQuota(r.id)).token;
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
          : e.message,
      );
      if (e.message === "SUBSCRIPTION") setModal("access");
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
                ref={editorRef}
                value={live || editorPhrase(draft)}
                readOnly={voiceActive || busy}
                spellCheck="true"
                style={editorFont ? { fontSize: editorFont + "px" } : undefined}
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
              {settings.sound && (
                <label className="field">
                  Сигнал перед напоминанием
                  <select
                    value={settings.cue || "alarm"}
                    onChange={(e) => {
                      setting({ cue: e.target.value });
                      previewCue(e.target.value);
                    }}
                  >
                    {ALERT_CUES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary cue-preview"
                    onClick={() => previewCue(settings.cue || "alarm")}
                  >
                    Прослушать
                  </button>
                </label>
              )}
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
                {isNative() &&
                  ` Напоминание поверх блокировки: ${perms?.fullscreen ? "разрешено" : "нужно разрешение"}.`}
                {isNative() &&
                  perms?.battery === false &&
                  " Экономия батареи включена: напоминание может задержаться."}
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
              {isNative() && perms && !perms.fullscreen && (
                <button
                  className="text-button full"
                  onClick={() =>
                    requestFullscreen()
                      .then(() => permissions())
                      .then(setPerms)
                      .catch((e) => setMessage(e.message))
                  }
                >
                  Разрешить напоминание поверх блокировки
                </button>
              )}
              {isNative() && perms?.battery === false && (
                <button
                  className="text-button full"
                  onClick={() =>
                    requestBattery()
                      .then(() => permissions())
                      .then(setPerms)
                      .catch((e) => setMessage(e.message))
                  }
                >
                  Отключить экономию батареи
                </button>
              )}
              {isNative() && (
                <button
                  className="text-button full"
                  onClick={() =>
                    requestAutostart()
                      .then((r) =>
                        setMessage(
                          r?.opened
                            ? "Разрешите автозапуск для этого приложения — иначе напоминания не восстановятся после перезагрузки телефона."
                            : r?.hint || "Разрешите автозапуск в настройках приложения.",
                        ),
                      )
                      .catch((e) => setMessage(e.message))
                  }
                >
                  Разрешить автозапуск (для работы после перезагрузки)
                </button>
              )}
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
        <WelcomeModal
          name={name}
          onName={setName}
          onStart={async () => {
            await setting({ name, onboarded: true });
            setModal(null);
          }}
        />
      )}
      {draft.dateConflict && !modal && (
        <DateConflictBubble
          onPickCalendar={() => {
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
          onPickText={() => {
            const next = parseEditor(editorPhrase(draft), {
              ...draft,
              selectedDates: [],
            });
            draftRef.current = next;
            setDraft(next);
            setCreating(true);
            setMessage("");
          }}
        />
      )}
      {modal === "event" && editing?.rule && (
        <EventModal
          rule={editing.rule}
          event={editing.event}
          busy={busy}
          voiceActive={voiceActive}
          onClose={() => {
            setEditing(null);
            setModal(null);
          }}
          onEdit={() => {
            editRule(editing.rule);
            setModal(null);
          }}
          onSkip={async () => {
            const r = editing.rule;
            try {
              setState(await skipOccurrence(r.id, editing.event.at));
              setModal(null);
            } catch (e) {
              setMessage(e.message);
            }
          }}
          onToggle={async () => {
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
          onDelete={() => setModal("delete")}
        />
      )}
      {modal === "delete" && editing?.rule && (
        <DeleteGroupModal
          rule={editing.rule}
          onBack={() => setModal("event")}
          onConfirm={async () => {
            setState(await deleteReminder(editing.rule.id));
            setModal(null);
            setEditing(null);
          }}
        />
      )}
      {modal === "access" && (
        <AccessModal
          billingConfigured={billingConfigured}
          bill={bill}
          email={email}
          onEmail={setEmail}
          keyValue={key}
          onKey={setKey}
          onClose={() => setModal(null)}
          onCheckout={(plan, mail) =>
            checkout(plan, mail).catch((e) => setMessage(e.message))
          }
          onCheckStatus={() =>
            billingStatus()
              .then(setBill)
              .catch((e) => setMessage(e.message))
          }
          onRecoveryKey={() => recoveryKey().then(setKey)}
          onRestore={(k) =>
            restoreKey(k)
              .then(setBill)
              .catch((e) => setMessage(e.message))
          }
        />
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
