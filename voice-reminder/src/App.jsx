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
  shortTime,
} from "./domain/calendar.js";
import {
  colorFor,
  buildGroup,
  occurrencesInMonth,
  dropDateWords,
} from "./domain/groups.js";
import {
  accessActive,
  dateSpeechEnabled,
  isPro,
  FREE_DATES_PER_EVENT,
  FREE_REMINDERS_PER_DAY,
} from "./domain/access.js";
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
import ScopeModal from "./components/ScopeModal.jsx";
import SwipeToDelete from "./components/SwipeToDelete.jsx";
import AccessModal from "./components/AccessModal.jsx";
import {
  ruleOccurrenceCount,
  ruleDates,
} from "./domain/schedule-dates.js";
import { playUiSound } from "./lib/ui-sounds.js";
import {
  eventCount,
  blank,
  cachedDrafts,
  dateLabel,
  dateNote,
  shiftMonth,
} from "./domain/draft-model.js";
import "./planner.css";
import "./agenda.css";
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
    [dayFilter, setDayFilter] = useState(null),
    // Выбор «только это событие / все» при удалении и смене времени.
    [scope, setScope] = useState(null),
    [clearingDay, setClearingDay] = useState(false),
    // Какая карточка сейчас правит время и что в ней введено.
    [editingTime, setEditingTime] = useState(null),
    [timeEdits, setTimeEdits] = useState({});
  const recording = useRef(),
    draftRef = useRef(draft),
    editorRef = useRef(null),
    mounted = useRef(true),
    starting = useRef(false),
    recognitionTask = useRef(null),
    saving = useRef(false),
    gate = useRef(sessionGate()),
    parsedTranscript = useRef(""),
    // Доступно ли распознавание дат из речи. Держим в ref: обработчики
    // голосовой сессии живут дольше одного рендера и должны видеть текущее
    // значение, а не то, что было при их создании.
    datesFromSpeech = useRef(false);
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
  useEffect(() => {
    datesFromSpeech.current = dateSpeechEnabled(bill);
  }, [bill]);
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
        const parsed = parseEditor(text, draftRef.current, new Date(), {
          dates: datesFromSpeech.current,
        });
        draftRef.current = parsed;
        setDraft(parsed);
        // Показываем расшифровку цифрами: дату и время человек проверяет
        // глазами, и «25.12 в 19:30» проверяется быстрее, чем словами.
        // Когда даты из речи не разбираются, слова даты просто убираем:
        // показывать «25.11» нельзя — напоминание встанет на сегодня,
        // и человек видел бы одно, а получил другое.
        setLive(
          datesFromSpeech.current
            ? toDigits(text, parsed)
            : dropDateWords(toDigits(text, parsed)),
        );
      };
      const session = startContinuousDictation({
        restartOnEnd: !isNative(),
        onStart: () => valid() && setVoice("listening"),
        onWaiting: () => valid() && setVoice("listening"),
        // Промежуточная расшифровка тоже цифрами: иначе во время речи
        // мелькали слова, а в конце текст менялся на цифры — выглядело как
        // «подмена». Разбор ещё не готов, поэтому передаём пустой объект.
        // Дни недели и «завтра» из речи убираем так же, как в готовом тексте:
        // иначе посреди диктовки мелькала дата, которой в напоминании не будет.
        onInterim: (text) =>
          valid() &&
          setLive(
            datesFromSpeech.current
              ? toDigits(text, draftRef.current || {})
              : dropDateWords(toDigits(text, draftRef.current || {})),
          ),
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
      const next = parseEditor(phrase, draftRef.current, new Date(), {
        dates: datesFromSpeech.current,
      });
      draftRef.current = next;
      setDraft(next);
      // Показываем фразу цифрами: «двадцать пятого декабря в 19:30»
      // читается и проверяется быстрее, чем «двадцать пятого декабря
      // в половину восьмого вечера». Сырая расшифровка остаётся в
      // originalTranscript и не теряется. Когда даты из речи не разбираются,
      // слова даты из подсказки убираем — напоминание встанет на сегодня.
      const shown = toDigits(phrase, next);
      setLive(datesFromSpeech.current ? shown : dropDateWords(shown));
    }, 140);
  }
  const pick = (date) => {
    const result = toggleEditorDate(draftRef.current, date, {
      // В бесплатной версии на событие можно отметить только одну дату.
      ...(isPro(bill) ? {} : { maxDates: FREE_DATES_PER_EVENT }),
    });
    if (result.blocked) {
      setMessage(
        `На одно событие в бесплатной версии можно выбрать только одну дату. Несколько дат — в ПРО-версии.`,
      );
      return;
    }
    draftRef.current = result.draft;
    setDraft(result.draft);
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
  /**
   * Убирает одно срабатывание, не трогая остальные даты.
   *
   * Для правила на несколько дат «удалить» напоминание целиком было бы
   * слишком грубо: человек убирает карточку одного дня. Остальные даты
   * остаются, а убранная попадает в исключения расписания.
   */
  async function removeOne(entry) {
    try {
      setState(await skipOccurrence(entry.reminderId, entry.at));
      setMessage("");
    } catch (e) {
      setMessage(e.message);
    }
  }
  /**
   * Меняет время одного срабатывания.
   *
   * Без окна: показываем поле ввода времени рядом с карточкой. Человек
   * печатает «19:30», нажимает галочку — и время перенесено. Остальные даты
   * правила не трогаем: смена времени одного дня не должна двигать серию.
   */
  async function changeTimeOne(entry, rule) {
    const time = timeEdits[entry.id];
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
      setMessage("Укажите время в формате чч:мм, например 19:30.");
      return;
    }
    const [h, m] = time.split(":").map(Number);
    if (h > 23 || m > 59) {
      setMessage("Такого времени не бывает: часы 0–23, минуты 0–59.");
      return;
    }
    try {
      // Исключаем старое срабатывание и добавляем новое время на эту дату.
      const shifted = {
        ...rule,
        schedule: {
          ...rule.schedule,
          kind: "dates",
          dates: [
            ...new Set([...(rule.schedule.dates || [entry.date])]),
          ].sort(),
          times: [
            ...new Set(
              [...(rule.schedule.times || [entry.time]), time].sort(),
            ),
          ],
          excludedInstants: [
            ...new Set([
              ...(rule.schedule.excludedInstants || []),
              entry.at,
            ]),
          ],
        },
      };
      setState(await putReminder(shifted));
      setTimeEdits((v) => {
        const next = { ...v };
        delete next[entry.id];
        return next;
      });
      setEditingTime(null);
      setMessage(`Время изменено на ${time}.`);
      playUiSound("confirm", { enabled: settings.uiSounds !== false });
    } catch (e) {
      setMessage(e.message);
    }
  }
  /** Открывает редактор группы: смена времени сразу на всех датах. */
  function changeTimeAll(rule) {
    editRule(rule);
    setMessage("");
  }
  /**
   * Удаляет все напоминания выбранного дня.
   *
   * Считаем по дню, а не по правилу: у правила может быть несколько времён,
   * и убирать его целиком из-за одного дня нельзя — пострадали бы другие дни.
   */
  async function clearDay(date) {
    const targets = entries.filter((e) => e.date === date);
    if (!targets.length) return;
    setClearingDay(true);
    playUiSound("delete", { enabled: settings.uiSounds !== false });
    try {
      // Каждый шаг берёт состояние, полученное предыдущим. Если читать
      // исходное состояние, шаги перезапишут друг друга и сохранится
      // результат только последнего — часть напоминаний вернулась бы.
      let next = state;
      for (const e of targets) {
        const rule = next.reminders.find((r) => r.id === e.reminderId);
        if (!rule) continue;
        const others = ruleDates(rule).filter((d) => d !== date);
        next =
          others.length > 0
            ? await skipOccurrence(e.reminderId, e.at)
            : await deleteReminder(e.reminderId);
      }
      setState(next);
      setMessage(`Удалено напоминаний: ${targets.length}`);
      playUiSound("confirm", { enabled: settings.uiSounds !== false });
    } catch (e) {
      setMessage(e.message);
    } finally {
      setClearingDay(false);
    }
  }
  async function persist(r) {
    let token;    try {
      if (billingConfigured) token = (await reserveQuota(r.id)).token;
      const s = await putReminder(r, {
        reservation: token,
        // В бесплатной версии — не больше трёх напоминаний в день.
        ...(isPro(bill) ? {} : { maxPerDay: FREE_REMINDERS_PER_DAY }),
      });
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
      // Проверяем до сохранения, чтобы сообщение появилось сразу и в том же
      // виде, что и при сохранении: в бесплатной версии — не больше трёх
      // напоминаний в день.
      assertDailyCapacity(state.reminders, [rule], {
        events: state.events,
        ...(isPro(bill) ? {} : { maxPerDay: FREE_REMINDERS_PER_DAY }),
      });
      await persist(rule);
      const fresh = blank(
        state.reminders.length +
          (state.reminders.some((r) => r.id === rule.id) ? 0 : 1),
      );
      draftRef.current = fresh;
      setDraft(fresh);
      setLive("");
      setCreating(false);
      // При успехе обычно ничего не показываем: человек видит, что поле
      // очистилось и напоминание ушло в список.
      //
      // Исключение — дата. В бесплатной версии она берётся только с
      // календаря, а если её не отметили, напоминание встаёт на сегодня.
      // Молчать об этом нельзя: сказанное «завтра» осталось бы у человека
      // в голове, а сработало бы сегодня. Поэтому сообщаем, на какой день
      // записали, — но только когда дату не выбирали.
      setMessage(isPro(bill) ? "" : dateNote(current));
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
                placeholder="Нажмите «Начать». Назовите время и событие, например: «в семь утра полить цветы». Даты отметьте на календаре, затем нажмите «Готово». Если дату не отметили, напоминание встанет на сегодня."
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
                  setDayFilter(null);
                  setMessage("");
                }}
              >
                ← Главная
              </button>
            </header>
            {/* День и число событий. Переключателя месяца здесь больше нет:
                в раздел приходят из календаря за конкретным днём, а листать
                месяцы удобнее на главной. */}
            <div className="day-filter">
              <strong>
                {dayFilter ? dateLabel(dayFilter) : "Все события"}
                {" · "}
                {eventCount(shownEntries.length)}
              </strong>
            </div>
            {!shownEntries.length && (
              <div className="empty-agenda">
                <Icon name="bell" size={32} />
                <h2>
                  {dayFilter ? "В этот день нет событий" : "Нет событий"}
                </h2>
                <p>
                  Вернитесь на главную, нажмите «Начать» и выберите день.
                </p>
              </div>
            )}
            {shownEntries.length > 0 && (
              <div className="agenda-list">
                {shownEntries.map((e) => {
                  const rule = state.reminders.find(
                    (r) => r.id === e.reminderId,
                  );
                  const past = e.at < Date.now();
                  return (
                    <article
                      key={e.id}
                      className={
                        "agenda-card" + (past ? " past" : "") + " is-new"
                      }
                      style={eventCardStyle(e.color)}
                    >
                      <button
                        className="agenda-main"
                        onClick={() => {
                          if (!rule) return;
                          setEditing({ rule, event: e });
                          setModal("event");
                        }}
                      >
                        <time>{e.time}</time>
                        <span>{e.text}</span>
                      </button>
                      <div className="agenda-actions">
                        {/* Переключатель удаляет напоминание. Всегда
                            включён: он показывает, что напоминание есть, а
                            выключение означает удаление. Прошедшее событие
                            убирается так же — это и просили. */}
                        <label className="agenda-switch">
                          <input
                            type="checkbox"
                            checked
                            aria-label={
                              past
                                ? "Удалить прошедшее напоминание"
                                : "Удалить напоминание"
                            }
                            onChange={() => {
                              if (!rule) return;
                              playUiSound("delete", {
                                enabled: settings.uiSounds !== false,
                              });
                              const count = ruleOccurrenceCount(rule);
                              if (count <= 1) {
                                removeOne(e);
                                return;
                              }
                              setScope({
                                action: "delete",
                                rule,
                                event: e,
                                dates: count,
                              });
                              setModal("scope");
                            }}
                          />
                          <span aria-hidden="true" />
                        </label>
                        {/* Перо меняет время: тот же выбор «одно / все». */}
                        <button
                          className="agenda-pen"
                          aria-label="Изменить время"
                          onClick={() => {
                            if (!rule) return;
                            playUiSound("edit", {
                              enabled: settings.uiSounds !== false,
                            });
                            const count = ruleOccurrenceCount(rule);
                            if (count <= 1) {
                              setEditingTime(e.id);
                              setTimeEdits((v) => ({ ...v, [e.id]: e.time }));
                              return;
                            }
                            setScope({
                              action: "time",
                              rule,
                              event: e,
                              dates: count,
                            });
                            setModal("scope");
                          }}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                      </div>
                      {/* Правка времени прямо в карточке: без окна и без
                          ухода с экрана. Поле появляется плавно. */}
                      {editingTime === e.id && (
                        <div className="agenda-time-edit">
                          <input
                            type="time"
                            value={timeEdits[e.id] || e.time}
                            aria-label="Новое время"
                            onChange={(ev) =>
                              setTimeEdits((v) => ({
                                ...v,
                                [e.id]: ev.target.value,
                              }))
                            }
                          />
                          <button
                            className="agenda-time-save"
                            onClick={() => changeTimeOne(e, rule)}
                          >
                            Сохранить
                          </button>
                          <button
                            className="agenda-time-cancel"
                            onClick={() => setEditingTime(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {/* Слайдер намеренно внизу и отдельно от карточек: удаление всех
                напоминаний дня необратимо, поэтому жест отличается от
                обычного нажатия. */}
            {dayFilter && shownEntries.length > 0 && (
              <SwipeToDelete
                label="Удалить все!"
                busy={clearingDay}
                onConfirm={() => clearDay(dayFilter)}
              />
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
                {isPro(bill)
                  ? "Без ограничений: любое число напоминаний в день, несколько дат на событие, распознавание дат голосом."
                  : `Бесплатно: до ${FREE_REMINDERS_PER_DAY} напоминаний в день и одна дата на событие. В ПРО-версии — без ограничений, несколько дат на событие и распознавание дат голосом. Сохранённые напоминания продолжают работать.`}
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
            const next = parseEditor(
              editorPhrase(draft),
              {
                ...draft,
                selectedDates: [],
              },
              new Date(),
              { dates: datesFromSpeech.current },
            );
            draftRef.current = next;
            setDraft(next);
            setCreating(true);
            setMessage("");
          }}
        />
      )}
      {modal === "scope" && scope && (
        <ScopeModal
          action={scope.action}
          text={scope.rule.text}
          dateLabel={dateLabel(scope.event.date)}
          occurrences={scope.dates}
          busy={busy}
          onBack={() => {
            setModal(null);
            setScope(null);
          }}
          onOne={async () => {
            const { action, event } = scope;
            setModal(null);
            setScope(null);
            if (action === "delete") {
              await removeOne(event);
            } else {
              // Правку времени открываем в самой карточке, не уводя с экрана.
              setEditingTime(event.id);
              setTimeEdits((v) => ({ ...v, [event.id]: event.time }));
            }
            playUiSound("confirm", { enabled: settings.uiSounds !== false });
          }}
          onAll={async () => {
            const { action, rule } = scope;
            setModal(null);
            setScope(null);
            try {
              if (action === "delete") {
                playUiSound("delete", {
                  enabled: settings.uiSounds !== false,
                });
                setState(await deleteReminder(rule.id));
                setMessage("Напоминание удалено со всех дат.");
              } else {
                playUiSound("edit", { enabled: settings.uiSounds !== false });
                changeTimeAll(rule);
              }
            } catch (e) {
              setMessage(e.message);
            }
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
