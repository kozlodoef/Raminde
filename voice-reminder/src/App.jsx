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
  liveEvents,
  restoreSchedule,
  setSettings,
  putReminder,
  deleteReminder,
  acknowledge,
  snooze,
  skipOccurrence,
  dismissOccurrence,
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
  hasPastOccurrence,
  PAST_TIME_MESSAGE,
} from "./domain/calendar.js";
import {
  colorFor,
  buildGroup,
  occurrencesInMonth,
  dropDateWords,
} from "./domain/groups.js";
import {
  accessActive,
  dailyLimit,
  dateSpeechEnabled,
  isPro,
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
import FlipTimePicker from "./components/FlipTimePicker.jsx";
import AccessModal from "./components/AccessModal.jsx";
import PrivacyModal from "./components/PrivacyModal.jsx";
import {
  occurrenceScope,
  scopeWording,
  ruleDates,
} from "./domain/schedule-dates.js";
import { playUiSound } from "./lib/ui-sounds.js";
import {
  parseNumericInput,
  numericFieldValue,
  dropDraft,
} from "./lib/numeric-field.js";
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
    // message — только про сбой: он всплывает пузырём поверх экрана.
    [message, setMessage] = useState(""),
    // note — спокойное пояснение под полем ввода. Пузыря не заслуживает:
    // ничего не сломалось, человеку просто нужно знать, на какую дату записали.
    [note, setNote] = useState(""),
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
    [timeEdits, setTimeEdits] = useState({}),
    // Правка времени сразу на всех датах: { rule, event }. Нужна, чтобы
    // «Изменить время везде» меняло время на месте, а не уводило на главную.
    [editingTimeAll, setEditingTimeAll] = useState(null),
    // Поле ввода в фокусе: подсказка на это время скрывается.
    [editorFocused, setEditorFocused] = useState(false),
    // Карточки, которые сейчас уезжают вправо после удаления.
    [removing, setRemoving] = useState([]),
    // Черновики числовых полей настроек: то, что человек набрал прямо сейчас.
    //
    // Нужны, чтобы поле можно было очистить. Пока значение уходит в
    // настройки сразу, пустое поле даёт 0, проверка «больше нуля» не
    // проходит — и React возвращает в поле прежнее число. Стереть «5»
    // было невозможно.
    [numDrafts, setNumDrafts] = useState({});
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
    // Даты из речи доступны всем: ограничение платной версии снято.
    // Оставляем в ref, чтобы обработчики голосовой сессии видели текущее
    // значение и не зависели от момента создания.
    datesFromSpeech = useRef(true);
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
    if (!note) return;
    const timer = setTimeout(() => setNote(""), 6000);
    return () => clearTimeout(timer);
  }, [note]);
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
  // Частая проверка «не звенит ли прямо сейчас».
  //
  // В нативной версии она берёт только список срабатываний: полное состояние
  // несёт все правила и настройки, а они меняются лишь действиями самого
  // человека. В веб-версии проверка остаётся полной — там она же двигает
  // расписание, без неё напоминания не срабатывают вовсе.
  const tick = async () => {
    if (saving.current) return;
    if (!isNative()) return refresh();
    try {
      const events = await liveEvents();
      setState((prev) =>
        prev && !saving.current ? { ...prev, events } : prev,
      );
    } catch {
      // Проверка идёт каждые полторы секунды: сообщать о каждой неудаче
      // нельзя, иначе экран засыпало бы ошибками при сворачивании.
    }
  };
  useEffect(() => {
    mounted.current = true;
    primeAudio();
    refresh();
    permissions()
      .then(setPerms)
      .catch(() => {});
    // Восстановление расписания — один раз при запуске, вне опроса.
    // Раньше оно происходило внутри каждой проверки состояния, то есть
    // каждые полторы секунды: на бюджетных телефонах это заметно.
    restoreSchedule();
    const id = setInterval(() => {
      if (!document.hidden) tick();
    }, 1500);
    // Полное состояние — реже: раз в двадцать секунд достаточно, чтобы
    // заметить правку, сделанную в другом окне или при отложенном сигнале.
    const full = setInterval(() => {
      if (!document.hidden) refresh();
    }, 20000);
    const visible = () => {
      if (document.hidden) {
        cancelRecording();
        setCreating(false);
      } else {
        // Возврат в приложение — как раз тот случай, когда расписание надо
        // пересчитать: телефон мог пробыть в глубоком сне.
        restoreSchedule();
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
      clearInterval(full);
      cancelRecording();
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const theme = state.settings.theme;
    document.documentElement.dataset.theme = theme;
    // Статус-бар Android.
    //
    // theme-color в index.html привязан к системной теме, а настройка
    // приложения может с ней не совпадать: при «тёмной в приложении,
    // светлой в системе» полоса статуса оставалась светлой и спорила с
    // фоном экрана. Цвет берём из вычисленного фона — тогда он всегда
    // совпадает с тем, что человек видит.
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim();
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.remove());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = bg || (dark ? "#0d1923" : "#f5f0e6");
    document.head.appendChild(meta);
    // Флаг для CSS: в тёмной теме нужны светлые системные значки.
    document.documentElement.dataset.scheme = dark ? "dark" : "light";
  }, [state?.settings.theme, !!state]);
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
  // Системная кнопка «Назад» на Android.
  //
  // Нативная сторона спрашивает эту функцию, потому что только веб-часть
  // знает, открыто ли модальное окно, на какой вкладке человек и идёт ли
  // запись. Возвращаем true, если назад есть куда идти, — тогда приложение
  // не закрывается. Раньше кнопка закрывала его всегда, даже из «Событий».
  //
  // Порядок важен: сначала закрывается окно, потом диктовка, потом
  // вкладка — от самого вложенного к самому внешнему.
  const back = () => {
    if (modal) {
      // Подтверждение удаления возвращает в карточку, а не на экран:
      // иначе человек терял контекст и не понимал, что удалил.
      setModal(modal === "delete" ? "event" : null);
      return true;
    }
    if (voice !== "idle" || busy) {
      cancelRecording();
      setCreating(false);
      setBusy(false);
      return true;
    }
    if (tab !== "home") {
      setTab("home");
      setDayFilter(null);
      setMessage("");
      return true;
    }
    if (dayFilter) {
      setDayFilter(null);
      return true;
    }
    return false;
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    // Обработчик держит ссылку на актуальную функцию через ref: иначе
    // пришлось бы переустанавливать его на каждое изменение состояния.
    window.__remindeBack = () => {
      try {
        return backRef.current();
      } catch {
        return false;
      }
    };
    return () => {
      delete window.__remindeBack;
    };
  }, []);
  // Разбор дат включён всегда, поэтому ref не должен зависеть от ответа
  // платёжного сервера: dateSpeechEnabled() возвращает true.
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

  /**
   * Сообщение, если выбранное время уже прошло.
   *
   * Проверяем и даты, и времена сразу: человек должен увидеть это при вводе,
   * а не узнать при сохранении, когда всё уже набрано.
   *
   * @param {object} current — текущий черновик
   * @returns {string} текст сообщения или пустая строка
   */
  function pastNotice(current) {
    const dates = current?.selectedDates?.length
      ? current.selectedDates
      : current?.dates || [];
    const times = current?.times || current?.schedule?.times || [];
    if (!dates.length || !times.length) return "";
    const schedule = {
      kind: "dates",
      dates,
      times,
      timezoneMode: "deviceLocal",
    };
    return hasPastOccurrence(schedule, Date.now()) ? PAST_TIME_MESSAGE : "";
  }
  function typePhrase(phrase) {
    setLive(phrase);
    setCreating(!!phrase.trim());
    setMessage("");
    setNote("");
    if (parseTimer.current) clearTimeout(parseTimer.current);
    parseTimer.current = setTimeout(() => {
      parseTimer.current = null;
      const next = parseEditor(phrase, draftRef.current, new Date(), {
        dates: datesFromSpeech.current,
      });
      draftRef.current = next;
      setDraft(next);
      // Прошедшее время видно сразу при вводе, а не только при сохранении:
      // человек успевает поправить дату, пока не нажал «Готово».
      setMessage(pastNotice(next));
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
    // Несколько дат на одно событие доступны всем: ограничение снято.
    const result = toggleEditorDate(draftRef.current, date);
    if (result.blocked) return;
    draftRef.current = result.draft;
    setDraft(result.draft);
    // Отметили день, на котором время уже прошло, — говорим сразу.
    setMessage(pastNotice(result.draft));
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
    setNote("");
    setLive("");
    setEditing(null);
  }
  /**
   * Убирает одно срабатывание, не трогая остальные даты.
   *
   * Для правила на несколько дат «удалить» напоминание целиком было бы
   * слишком грубо: человек убирает карточку одного дня. Остальные даты
   * остаются, а убранная попадает в исключения расписания.
   *
   * Сначала карточка уезжает вправо, и только потом исчезает из списка.
   * Удаление без анимации выглядит как рывок: карточка пропадает мгновенно,
   * и непонятно, что именно удалилось.
   */
  async function removeOne(entry) {
    setRemoving((v) => [...v, entry.id]);
    playUiSound("delete", { enabled: settings.uiSounds !== false });
    await new Promise((r) => setTimeout(r, 280));
    try {
      const rule = state.reminders.find((r) => r.id === entry.reminderId);
      // Последняя дата правила — удаляем само напоминание, а не только
      // срабатывание. Иначе от него оставалась бы пустая запись, а у
      // сработавшего напоминания ещё и запись о показе: карточка
      // возвращалась на место, и удаление выглядело несработавшим.
      // skipOccurrence сам разбирает прошедшие срабатывания: их нельзя
      // «пропустить», только снять. Сироту (правило уже удалено, запись о
      // показе осталась) снимаем напрямую — иначе карточка не уходила.
      const last =
        rule && ruleDates(rule).filter((d) => d !== entry.date).length === 0;
      setState(
        last
          ? await deleteReminder(entry.reminderId)
          : await (rule
              ? skipOccurrence(entry.reminderId, entry.at)
              : dismissOccurrence(entry.reminderId, entry.at)),
      );
      setMessage("");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setRemoving((v) => v.filter((id) => id !== entry.id));
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
      // Успех виден по самой карточке — новое время уже стоит в ней.
      setMessage("");
      playUiSound("confirm", { enabled: settings.uiSounds !== false });
    } catch (e) {
      setMessage(e.message);
    }
  }
  /**
   * Меняет время на всех датах правила.
   *
   * Раньше здесь открывался редактор главной (editRule): человека
   * перебрасывало на другой экран с полем ввода, хотя он просил только
   * поправить время. Теперь время меняется на месте, в той же карточке:
   * открывается то же перекидное поле, что и для одного дня, но применённое
   * ко всем датам сразу.
   */
  function changeTimeAll(rule, entry) {
    setEditingTimeAll({ rule, event: entry });
    setTimeEdits((v) => ({ ...v, [entry.id]: entry.time }));
  }
  /**
   * Применяет новое время ко всем датам правила.
   *
   * Старое время заменяется новым во всём списке: если было «09:00 и 12:00»,
   * а человек поменял 09:00 на 10:00, станет «10:00 и 12:00». Так же
   * снимаются отметки о пропущенных срабатываниях на старом времени —
   * иначе перенесённое время могло оказаться исключённым.
   */
  async function applyTimeEverywhere() {
    const target = editingTimeAll;
    if (!target) return;
    const { rule, event } = target;
    const time = timeEdits[event.id];
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
      const times = [...new Set(rule.schedule.times || [])];
      const nextTimes = [...new Set(times.map((t) => (t === event.time ? time : t)))].sort();
      const shifted = {
        ...rule,
        schedule: {
          ...rule.schedule,
          kind: "dates",
          times: nextTimes,
          // Отметки о пропуске относились к старому времени: после переноса
          // они бы указывали на момент, которого больше нет.
          excludedInstants: [],
        },
      };
      setState(await putReminder(shifted));
      setEditingTimeAll(null);
      setTimeEdits((v) => {
        const next = { ...v };
        delete next[event.id];
        return next;
      });
      setMessage("");
      playUiSound("confirm", { enabled: settings.uiSounds !== false });
    } catch (e) {
      setMessage(e.message);
    }
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
    // Карточки уезжают вправо все сразу: так видно, что удаляется именно
    // весь день, а не одна строка.
    setRemoving(targets.map((e) => e.id));
    playUiSound("delete", { enabled: settings.uiSounds !== false });
    await new Promise((r) => setTimeout(r, 300));
    try {
      // Каждый шаг берёт состояние, полученное предыдущим. Если читать
      // исходное состояние, шаги перезапишут друг друга и сохранится
      // результат только последнего — часть напоминаний вернулась бы.
      let next = state;
      let failed = 0;
      for (const e of targets) {
        const rule = next.reminders.find((r) => r.id === e.reminderId);
        // Правила может не быть: запись о показе осталась после удаления.
        // Такие карточки тоже убираем, иначе «Удалить всё» оставляло их.
        if (!rule) {
          try {
            next = await dismissOccurrence(e.reminderId, e.at);
          } catch {
            failed++;
          }
          continue;
        }
        const others = ruleDates(rule).filter((d) => d !== date);
        try {
          next =
            others.length > 0
              ? await skipOccurrence(e.reminderId, e.at)
              : await deleteReminder(e.reminderId);
        } catch {
          // Одна неудача не должна останавливать уборку всего дня: раньше
          // первая же ошибка прерывала цикл, и часть событий оставалась.
          failed++;
        }
      }
      setState(next);
      // Успех виден по пустому дню — пузыря не показываем. А вот неполная
      // уборка это сбой: часть напоминаний осталась, и об этом надо сказать.
      setMessage(
        failed
          ? `Не удалось удалить напоминаний: ${failed} из ${targets.length}`
          : "",
      );
      playUiSound("confirm", { enabled: settings.uiSounds !== false });
    } catch (e) {
      setMessage(e.message);
    } finally {
      setClearingDay(false);
      setRemoving([]);
    }
  }
  async function persist(r) {
    let token;
    try {
      if (billingConfigured) token = (await reserveQuota(r.id)).token;
      // Предел на день передаётся в репозиторий явно: без подписки — три
      // напоминания, с подпиской — техническая граница в 24.
      const s = await putReminder(r, {
        reservation: token,
        maxPerDay: dailyLimit(bill),
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
      // виде, что и при сохранении. Без подписки предел — три напоминания в
      // день, с подпиской — технический максимум 24 (по числу часов).
      assertDailyCapacity(state.reminders, [rule], {
        events: state.events,
        maxPerDay: dailyLimit(bill),
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
      // При успехе пузыря не показываем: человек видит, что поле очистилось
      // и напоминание ушло в список. Всплывающее сообщение — только про сбой.
      //
      // Исключение — дата. Если её не назвали голосом и не отметили на
      // календаре, напоминание встаёт на сегодня. Молчать об этом нельзя:
      // сказанное «завтра» осталось бы у человека в голове, а сработало бы
      // сегодня. Но это и не ошибка — поэтому пояснение идёт тихой строкой
      // под полем, а не пузырём поверх экрана.
      setNote(dateNote(current));
      setMessage("");
      setEditing(null);
    } catch (e) {
      setCreating(false);
      setMessage(e.message);
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
        {/* Пузырь — только про сбой: что-то не сохранилось, не удалилось,
            нет разрешения. Подтверждения успеха и пояснения живут без него. */}
        {message && (
          <div className="floating-bubble" role="alert" aria-live="assertive">
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
        {/* Тихое пояснение: на какую дату записали, что нужно разрешить.
            Это не сбой, поэтому строкой, а не пузырём поверх экрана. */}
        {note && (
          <p className="editor-note" role="status">
            {note}
          </p>
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
                // Подсказка исчезает, как только человек коснулся поля.
                //
                // Иначе она мешает: текст подсказки виден, пока поле пустое,
                // и человек начинает печатать поверх него — непонятно, стёр
                // он подсказку или она часть напоминания. Убираем при фокусе
                // и не возвращаем до конца ввода.
                placeholder={
                  editorFocused
                    ? ""
                    : "Нажмите «Начать». Назовите время и событие, например: «в семь утра полить цветы». Даты отметьте на календаре, затем нажмите «Готово». Если дату не отметили, напоминание встанет на сегодня."
                }
                onFocus={() => setEditorFocused(true)}
                onBlur={() => setEditorFocused(false)}
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
            <header className="page-title events-title">
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
            {/* Удаление всего дня — сразу под датой. Надпись и
                переключатель того же вида, что на карточках: включён —
                события на месте, выключили — день очищается. */}
            {dayFilter && shownEntries.length > 0 && (
              <div className="delete-day-row">
                <span className="delete-day-label">
                  {clearingDay ? "Удаляю…" : "Удалить всё"}
                </span>
                <label
                  className="agenda-switch"
                  style={{ "--event-color": "var(--danger)" }}
                >
                  <input
                    type="checkbox"
                    checked
                    disabled={clearingDay}
                    aria-label="Удалить все события этого дня"
                    onChange={() => clearDay(dayFilter)}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
            )}
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
                        "agenda-card" +
                        (past ? " past" : "") +
                        (removing.includes(e.id) ? " is-leaving" : "")
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
                              // Правила может не быть: напоминание уже
                              // удалили, а запись о показе осталась. Раньше
                              // здесь стоял выход, и такая карточка висела
                              // на экране навсегда — удалить её было нечем.
                              playUiSound("delete", {
                                enabled: settings.uiSounds !== false,
                              });
                              const scope = rule ? occurrenceScope(rule) : null;
                              if (!scope || !scope.ask) {
                                removeOne(e);
                                return;
                              }
                              setScope({
                                action: "delete",
                                rule,
                                event: e,
                                ...scope,
                                wording: scopeWording(rule),
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
                            const scope = occurrenceScope(rule);
                            if (!scope.ask) {
                              setEditingTime(e.id);
                              setTimeEdits((v) => ({ ...v, [e.id]: e.time }));
                              return;
                            }
                            setScope({
                              action: "time",
                              rule,
                              event: e,
                              ...scope,
                              wording: scopeWording(rule),
                            });
                            setModal("scope");
                          }}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                      </div>
                      {/* Правка времени прямо в карточке: перекидные
                          цифры. Без ухода с экрана — человек видит, к
                          какому дню относится время. */}
                      {editingTime === e.id && (
                        <FlipTimePicker
                          value={timeEdits[e.id] || e.time}
                          soundEnabled={settings.uiSounds !== false}
                          onChange={(v) =>
                            setTimeEdits((prev) => ({ ...prev, [e.id]: v }))
                          }
                          onDone={() => changeTimeOne(e, rule)}
                          onCancel={() => setEditingTime(null)}
                        />
                      )}
                      {/* Правка времени сразу на всех датах этой группы.
                          Отдельная панель, потому что действие другое:
                          меняются все даты, а не один день. */}
                      {editingTimeAll?.event?.id === e.id && (
                        <FlipTimePicker
                          value={timeEdits[e.id] || e.time}
                          soundEnabled={settings.uiSounds !== false}
                          note="Новое время применится ко всем датам этого напоминания."
                          onChange={(v) =>
                            setTimeEdits((prev) => ({ ...prev, [e.id]: v }))
                          }
                          onDone={applyTimeEverywhere}
                          onCancel={() => {
                            setEditingTimeAll(null);
                            setTimeEdits((prev) => {
                              const next = { ...prev };
                              delete next[e.id];
                              return next;
                            });
                          }}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
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
                  {/* Режима «только голосом» здесь больше нет: без
                      уведомления напоминание легко пропустить, а озвучка не
                      оставляет следа в шторке. Сохранённое значение voice
                      переводится в первый режим при чтении настроек — см.
                      normalizeSettings в domain/repository.js. */}
                  <option value="voiceAndNotification">
                    Голосом и уведомлением
                  </option>
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
                      inputMode="numeric"
                      value={numericFieldValue(
                        numDrafts.repeatMinutes,
                        settings.repeatMinutes,
                      )}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setNumDrafts((d) => ({ ...d, repeatMinutes: raw }));
                        const r = parseNumericInput(raw, { min: 1 });
                        // Пустое поле — промежуточное состояние: человек
                        // стирает старое, чтобы набрать новое. Сохранённое
                        // значение при этом не меняем.
                        if (r.value !== null)
                          setting({ repeatMinutes: r.value });
                      }}
                      // Ушли из поля с пустым или негодным содержимым —
                      // возвращаем сохранённое значение, а не оставляем
                      // пустоту и не превращаем её в ноль.
                      onBlur={() =>
                        setNumDrafts((d) => dropDraft(d, "repeatMinutes"))
                      }
                    />
                  </label>
                  <label className="field">
                    Максимум попыток, 0 — без ограничения
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={numericFieldValue(
                        numDrafts.maxAttempts,
                        settings.maxAttempts,
                      )}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setNumDrafts((d) => ({ ...d, maxAttempts: raw }));
                        const r = parseNumericInput(raw, {
                          min: 0,
                          max: 99,
                        });
                        if (r.value !== null) setting({ maxAttempts: r.value });
                      }}
                      onBlur={() =>
                        setNumDrafts((d) => dropDraft(d, "maxAttempts"))
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
                  ? "Подписка активна — предел на день снят"
                  : active
                    ? `Подписка не оформлена. Первый месяц бесплатно · осталось ${daysLeft} дн.`
                    : `Без подписки — до ${FREE_REMINDERS_PER_DAY} напоминаний в день`}
              </p>
              <p className="hint">
                Голос, даты словами («завтра», «двадцать пятого декабря»),
                несколько дат на событие и напоминания на любой срок доступны
                всем. Подписка снимает только дневной предел: с ней можно
                ставить до 24 напоминаний в день. Сохранённые напоминания
                работают при любом состоянии подписки.
              </p>
              <button
                className="secondary full"
                onClick={() => setModal("access")}
              >
                Подписка и восстановление
              </button>
            </div>
            <div className="settings-card">
              <h2>Данные и конфиденциальность</h2>
              <p className="hint">
                Напоминания, настройки и статистика хранятся только на этом
                телефоне. Текст напоминаний никуда не отправляется.
              </p>
              <button
                className="secondary full"
                onClick={() => setModal("privacy")}
              >
                Политика конфиденциальности
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
                        // Подсказка «разрешите автозапуск» — не сбой, а
                        // пояснение: её место в тихой строке, не в пузыре.
                        r?.opened
                          ? setNote(
                              "Разрешите автозапуск для этого приложения — иначе напоминания не восстановятся после перезагрузки телефона.",
                            )
                          : setNote(
                              r?.hint ||
                                "Разрешите автозапуск в настройках приложения.",
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
          wording={scope.wording}
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
            const { action, rule, event } = scope;
            setModal(null);
            setScope(null);
            try {
              if (action === "delete") {
                playUiSound("delete", {
                  enabled: settings.uiSounds !== false,
                });
                setState(await deleteReminder(rule.id));
                // Карточки уже нет — подтверждение пузырём не нужно.
                setMessage("");
              } else {
                // Время меняем на месте: человек просил поправить время, а не
                // открыть редактор на другом экране.
                playUiSound("edit", { enabled: settings.uiSounds !== false });
                changeTimeAll(rule, event);
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
      {modal === "privacy" && <PrivacyModal onClose={() => setModal(null)} />}
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
