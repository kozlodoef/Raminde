import React, { useEffect, useRef, useState } from "react";
import { isNative } from "./lib/native.js";
import { startRecognition } from "./lib/speech.js";
import {
  speak,
  cancelSpeech,
  playAlarm,
  stopAlarm,
  sendPush,
  primeAudio,
} from "./lib/alerts.js";
import { parseIntent } from "./domain/intent.js";
import {
  defaultSchedule,
  describe,
  localDate,
  nextOccurrences,
  pad,
  shortTime,
  validateSchedule,
  zone,
  zonedTime,
} from "./domain/calendar.js";
import {
  defaults,
  getState,
  setSettings,
  putReminder,
  deleteReminder,
  skipNext,
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
const uid = () => crypto.randomUUID();
function Icon({ name, size = 24 }) {
  const paths = {
    mic: "M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
    settings:
      "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z",
    plus: "M12 5v14M5 12h14",
    close: "M6 6l12 12M18 6L6 18",
    bell: "M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3ZM10 21h4",
    check: "M5 12l4 4L19 6",
    arrow: "M5 12h14M13 6l6 6-6 6",
    stop: "M6 6h12v12H6Z",
    edit: "M4 20l4-1L20 7l-3-3L5 16Z",
    trash: "M4 6h16M9 3h6M7 6l1 15h8l1-15M10 10v7M14 10v7",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.bell} />
    </svg>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const prior = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        );
        if (!els?.length) return;
        const a = els[0],
          b = els[els.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div className="backdrop">
      <section
        ref={ref}
        tabIndex={-1}
        className={"sheet " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          {onClose && (
            <button
              className="icon-button"
              aria-label="Закрыть"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>
  );
}
function Toggle({ label, value, onChange, description }) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        className="toggle"
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Clock({ value }) {
  const hm = value || "––:––";
  return (
    <div className="clock" aria-label={hm}>
      <span className="digit" key={"h" + hm.slice(0, 2)}>
        {hm.slice(0, 2)}
      </span>
      <span className="colon">:</span>
      <span className="digit" key={"m" + hm.slice(3)}>
        {hm.slice(3)}
      </span>
    </div>
  );
}
function Wheel({ label, value, values, onChange }) {
  const ref = useRef(),
    timer = useRef();
  useEffect(() => {
    const selected = values.indexOf(value);
    if (ref.current && selected >= 0) ref.current.scrollTop = selected * 48;
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="wheel-column">
      <span className="wheel-label">{label}</span>
      <div
        className="wheel"
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(e) => {
          const i = values.indexOf(value);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(
              values[
                Math.max(
                  0,
                  Math.min(
                    values.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                )
              ],
            );
          }
        }}
        onScroll={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const i = Math.round(ref.current.scrollTop / 48);
            if (values[i] !== undefined && values[i] !== value)
              onChange(values[i]);
          }, 100);
        }}
      >
        <div className="wheel-space" />
        {values.map((v) => (
          <button
            key={v}
            role="option"
            aria-selected={v === value}
            className={v === value ? "chosen" : ""}
            onClick={() => onChange(v)}
          >
            {pad(v)}
          </button>
        ))}
        <div className="wheel-space" />
      </div>
    </div>
  );
}
function TimeWheel({ value, onChange }) {
  const [h, m] = (value || "09:00").split(":").map(Number);
  return (
    <div className="time-picker">
      <Wheel
        label="Часы"
        value={h}
        values={Array.from({ length: 24 }, (_, i) => i)}
        onChange={(v) => onChange(pad(v) + ":" + pad(m))}
      />
      <span>:</span>
      <Wheel
        label="Минуты"
        value={m}
        values={Array.from({ length: 60 }, (_, i) => i)}
        onChange={(v) => onChange(pad(h) + ":" + pad(v))}
      />
    </div>
  );
}
function EditReminder({ initial, onSave, onClose, busy, settings }) {
  const [text, setText] = useState(initial.text || ""),
    [s, setS] = useState(initial.schedule || defaultSchedule()),
    [error, setError] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [remainingIssues, setRemainingIssues] = useState(initial.issues || []);
  const update = (patch) => {
    setS((prev) => ({ ...prev, ...patch }));
    setRemainingIssues([]);
  };
  const tz = s.timezoneMode === "fixed" ? s.timezone : zone();
  const next = validateSchedule(s).length
    ? []
    : nextOccurrences(s, Date.now(), 5);
  const date = s.kind === "once" ? localDate(new Date(s.at), tz) : s.anchorDate;
  const time = s.kind === "once" ? shortTime(s.at, tz) : s.times[0];
  const setTime = (hm) => {
    if (settings.pickerSound) {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      gain.gain.value = 0.02;
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.02);
      oscillator.onended = () => audio.close();
    }
    setS((prev) => {
      const currentZone =
        prev.timezoneMode === "fixed" ? prev.timezone : zone();
      return prev.kind === "once"
        ? {
            ...prev,
            at: new Date(
              zonedTime(
                localDate(new Date(prev.at), currentZone),
                hm,
                currentZone,
              ),
            ).toISOString(),
          }
        : { ...prev, times: [hm, ...prev.times.slice(1)] };
    });
    setRemainingIssues([]);
  };
  const save = async () => {
    const problems = validateSchedule(s);
    if (!text.trim()) problems.push("Введите текст напоминания");
    if (!next.length) problems.push("Нет будущих дат: проверьте условия");
    if (problems.length) {
      setError(problems.join(". "));
      return;
    }
    try {
      await onSave({
        ...initial,
        id: initial.id || uid(),
        text: text.trim(),
        schedule: s,
        enabled: initial.enabled ?? true,
        createdAt: initial.createdAt || Date.now(),
      });
    } catch (e) {
      setError(e.message);
    }
  };
  const list = (key, label, min, max) => (
    <label className="field">
      {label}
      <input
        value={(s[key] || []).join(", ")}
        inputMode="numeric"
        placeholder={`${min}…${max}, через запятую`}
        onChange={(e) =>
          update({
            [key]: e.target.value.split(/[ ,]+/).filter(Boolean).map(Number),
          })
        }
      />
    </label>
  );
  return (
    <Modal title="Расписание" onClose={onClose} wide>
      {initial.originalTranscript && (
        <p className="transcript">«{initial.originalTranscript}»</p>
      )}
      {remainingIssues.length > 0 && (
        <p className="notice">
          {remainingIssues.join(". ")}. Проверьте и исправьте поля ниже.
        </p>
      )}
      <label className="field">
        О чём напомнить
        <textarea
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRemainingIssues([]);
          }}
          placeholder="Например, принять таблетку"
        />
      </label>
      <div className="segmented">
        {[
          ["once", "Один раз"],
          ["calendar", "Повтор"],
          ["interval", "Интервал"],
        ].map(([kind, label]) => (
          <button
            key={kind}
            className={s.kind === kind ? "selected" : ""}
            onClick={() =>
              update({
                kind,
                ...(kind === "interval"
                  ? {
                      intervalMinutes: 60,
                      startAt: new Date(Date.now() + 60000).toISOString(),
                    }
                  : {}),
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      {s.kind !== "interval" && (
        <>
          <TimeWheel value={time} onChange={setTime} />
          <label className="field">
            {s.kind === "once" ? "Дата" : "Начать с"}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                if (s.kind === "once") {
                  update({
                    at: new Date(
                      zonedTime(e.target.value, time, tz),
                    ).toISOString(),
                  });
                } else update({ anchorDate: e.target.value });
              }}
            />
          </label>
        </>
      )}
      {s.kind === "calendar" && (
        <>
          <label className="field">
            Повторять
            <select
              value={s.frequency}
              onChange={(e) =>
                update({
                  frequency: e.target.value,
                  weekdays:
                    e.target.value === "weekly" && !s.weekdays.length
                      ? [1]
                      : s.weekdays,
                  monthDays:
                    ["monthly", "yearly"].includes(e.target.value) &&
                    !s.monthDays.length
                      ? [new Date().getDate()]
                      : s.monthDays,
                  months:
                    e.target.value === "yearly" && !s.months.length
                      ? [new Date().getMonth() + 1]
                      : s.months,
                })
              }
            >
              <option value="daily">По дням</option>
              <option value="weekly">По дням недели</option>
              <option value="monthly">По числам месяца</option>
              <option value="yearly">По месяцам года</option>
            </select>
          </label>
          <label className="field">
            Шаг повторения
            <input
              type="number"
              min="1"
              max="1000"
              value={s.interval}
              onChange={(e) => update({ interval: +e.target.value })}
            />
          </label>
          <div className="weekdays" aria-label="Дни недели">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w, i) => (
              <button
                key={w}
                aria-pressed={s.weekdays.includes(i + 1)}
                className={s.weekdays.includes(i + 1) ? "selected" : ""}
                onClick={() =>
                  update({
                    weekdays: s.weekdays.includes(i + 1)
                      ? s.weekdays.filter((v) => v !== i + 1)
                      : [...s.weekdays, i + 1],
                  })
                }
              >
                {w}
              </button>
            ))}
          </div>
          {list("monthDays", "Числа месяца (пусто — любой день)", 1, 31)}
          {list("months", "Месяцы (пусто — любой месяц)", 1, 12)}
          <label className="field">
            Чётность чисел
            <select
              value={s.dayParity}
              onChange={(e) => update({ dayParity: e.target.value })}
            >
              <option value="any">Любая</option>
              <option value="even">Чётные числа</option>
              <option value="odd">Нечётные числа</option>
            </select>
          </label>
          <p className="hint">
            Дни, числа, месяцы и чётность сочетаются вместе. Отсутствующее число
            месяца пропускается.
          </p>
        </>
      )}
      {s.kind === "interval" && (
        <>
          <label className="field">
            Каждые, минут
            <input
              type="number"
              min="1"
              value={s.intervalMinutes}
              onChange={(e) => update({ intervalMinutes: +e.target.value })}
            />
          </label>
          <label className="field">
            Первое срабатывание
            <input
              type="datetime-local"
              value={
                localDate(new Date(s.startAt)) + "T" + shortTime(s.startAt)
              }
              onChange={(e) => {
                if (e.target.value)
                  update({ startAt: new Date(e.target.value).toISOString() });
              }}
            />
          </label>
          <div className="two">
            <label className="field">
              Не раньше
              <input
                type="time"
                value={s.windowStart || ""}
                onChange={(e) => update({ windowStart: e.target.value })}
              />
            </label>
            <label className="field">
              Не позже
              <input
                type="time"
                value={s.windowEnd || ""}
                onChange={(e) => update({ windowEnd: e.target.value })}
              />
            </label>
          </div>
        </>
      )}
      {s.kind !== "once" && (
        <>
          <button
            className="text-button"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? "Скрыть" : "Дополнительные условия"}
          </button>
          {advanced && (
            <div className="advanced">
              {s.kind === "calendar" && (
                <>
                  <label className="field">
                    Дополнительное время (через запятую)
                    <input
                      placeholder="09:00, 20:00"
                      value={s.times.join(", ")}
                      onChange={(e) =>
                        update({
                          times: e.target.value.split(/[, ]+/).filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <Toggle
                    label="Последний день месяца"
                    value={s.lastDay}
                    onChange={(v) => update({ lastDay: v, monthDays: [] })}
                  />
                  <label className="field">
                    Порядковый день недели
                    <select
                      value={s.ordinal || ""}
                      onChange={(e) =>
                        update({
                          ordinal: e.target.value ? +e.target.value : null,
                          weekday: s.weekday || 1,
                          monthDays: [],
                          weekdays: [],
                        })
                      }
                    >
                      <option value="">Не ограничивать</option>
                      {[1, 2, 3, 4, 5, -1].map((v) => (
                        <option key={v} value={v}>
                          {v === -1 ? "Последний" : v + "-й"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.ordinal && (
                    <label className="field">
                      Какой день
                      <select
                        value={s.weekday}
                        onChange={(e) => update({ weekday: +e.target.value })}
                      >
                        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                          (w, i) => (
                            <option key={w} value={i + 1}>
                              {w}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                </>
              )}
              <div className="two">
                <label className="field">
                  До даты
                  <input
                    type="date"
                    value={s.until || ""}
                    onChange={(e) => update({ until: e.target.value || null })}
                  />
                </label>
                <label className="field">
                  Число срабатываний
                  <input
                    type="number"
                    min="1"
                    value={s.count || ""}
                    onChange={(e) =>
                      update({ count: e.target.value ? +e.target.value : null })
                    }
                  />
                </label>
              </div>
              <label className="field">
                Исключить даты (YYYY-MM-DD)
                <input
                  value={s.excludedDates.join(", ")}
                  onChange={(e) =>
                    update({
                      excludedDates: e.target.value
                        .split(/[, ]+/)
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="field">
                Часовой пояс
                <select
                  value={s.timezoneMode}
                  onChange={(e) => update({ timezoneMode: e.target.value })}
                >
                  <option value="deviceLocal">Местное время устройства</option>
                  <option value="fixed">Фиксированный пояс</option>
                </select>
              </label>
              {s.timezoneMode === "fixed" && (
                <label className="field">
                  IANA-пояс
                  <input
                    value={s.timezone}
                    onChange={(e) => update({ timezone: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}
        </>
      )}
      <div className="summary">
        <strong>{describe(s)}</strong>
        <small>Ближайшие срабатывания</small>
        {next.map((t) => (
          <span key={t}>
            {new Intl.DateTimeFormat("ru-RU", {
              timeZone: tz,
              day: "numeric",
              month: "short",
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(t)}
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error === "QUOTA"
            ? "Бесплатный лимит закончился. Откройте раздел подписки."
            : error}
        </p>
      )}
      <button
        className="primary full"
        disabled={busy || remainingIssues.length > 0}
        onClick={save}
      >
        {busy ? "Применяю…" : "Применить к черновику"}
      </button>
    </Modal>
  );
}
function AlarmBox({ event, settings, onAck, onSnooze }) {
  const [hearing, setHearing] = useState(false),
    [error, setError] = useState(""),
    rec = useRef();
  useEffect(() => {
    if (isNative()) return;
    let n = 0;
    const alert = () => {
      n++;
      if (settings.sound) playAlarm(false);
      if (settings.mode !== "voice")
        sendPush(
          "Remind me",
          settings.privateNotification ? "Новое напоминание" : event.text,
        );
      if (settings.mode !== "notification")
        speak((settings.name ? settings.name + "! " : "") + event.text);
    };
    alert();
    const timer = settings.repeat
      ? setInterval(() => {
          if (!settings.maxAttempts || n < settings.maxAttempts) alert();
        }, settings.repeatMinutes * 60000)
      : null;
    return () => {
      clearInterval(timer);
      stopAlarm();
      cancelSpeech();
      rec.current?.abort();
    };
  }, [event.id, event.attemptCount]);
  const listen = async () => {
    setError("");
    setHearing(true);
    try {
      rec.current = await startRecognition();
      const text = (await rec.current.promise)
        .toLowerCase()
        .trim()
        .replace(/[.!?,]/g, "");
      const words = settings.keywords
        .split(",")
        .map((w) => w.trim().toLowerCase());
      if (words.includes(text)) {
        onAck("voice");
      } else if (/отложи|позже/.test(text)) onSnooze();
      else
        setError(
          "Не услышал подтверждение. Нажмите «Понятно» или попробуйте ещё.",
        );
    } catch (e) {
      setError("Не удалось распознать ответ: " + e.message);
    } finally {
      setHearing(false);
    }
  };
  return (
    <Modal title="Пора вспомнить" wide>
      <div className="alarm-icon">
        <Icon name="bell" size={40} />
      </div>
      <h3 className="alarm-name">
        {settings.name ? settings.name + "!" : "Напоминание"}
      </h3>
      <p className="alarm-text">{event.text}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary full" onClick={() => onAck("button")}>
        <Icon name="check" />
        Понятно
      </button>
      <button className="secondary full" onClick={onSnooze}>
        Отложить на 5 минут
      </button>
      {settings.voiceAck && (
        <button
          className="text-button full"
          disabled={hearing}
          onClick={listen}
        >
          <Icon name="mic" />
          {hearing ? "Слушаю…" : "Ответить голосом"}
        </button>
      )}
      <p className="hint">
        Подтверждение завершает только это срабатывание, не всю серию.
      </p>
    </Modal>
  );
}

export { Icon, Modal, Toggle, EditReminder, AlarmBox };
