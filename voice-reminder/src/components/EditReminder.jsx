// components/EditReminder.jsx — создание и редактирование правила напоминания.
//
// Самый крупный экран приложения: текст, тип расписания (разовое / календарь /
// интервал), дни недели, числа месяца, чётность, часовой пояс, исключения,
// ограничения «до даты» и «сколько раз», расширенный режим и предпросмотр
// ближайших срабатываний.
//
// Отдельно про черновик: при разборе фразы часть полей может остаться
// непонятной (remainingIssues). Их нельзя молча сохранить — пользователь
// должен увидеть и исправить, поэтому кнопка сохранения блокируется, пока
// список не пуст.
import React, { useState } from "react";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import Toggle from "./Toggle.jsx";
import TimeWheel from "./TimeWheel.jsx";
import {
  defaultSchedule,
  describe,
  localDate,
  nextOccurrences,
  shortTime,
  validateSchedule,
  zone,
  zonedTime,
} from "../domain/calendar.js";
import {
  issuesAfterDraftChange,
  unresolvedDraftMessage,
} from "../domain/draftValidation.js";
import { languageTag, localizeIssue, t } from "../domain/i18n.js";

const uid = () => crypto.randomUUID();

export default function EditReminder({
  initial,
  onSave,
  onClose,
  busy,
  settings,
  language = "ru",
  queueSize = 1,
}) {
  const copy = (key, values) => t(language, key, values);
  const [text, setText] = useState(initial.text || ""),
    [s, setS] = useState(initial.schedule || defaultSchedule()),
    [error, setError] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [remainingIssues, setRemainingIssues] = useState(initial.issues || []);
  const update = (patch) => {
    setS((prev) => ({ ...prev, ...patch }));
    setRemainingIssues((issues) => issuesAfterDraftChange(issues, patch));
  };
  const tz = s.timezoneMode === "fixed" ? s.timezone : zone();
  const next = validateSchedule(s).length
    ? []
    : nextOccurrences(s, Date.now(), 5);
  const date = s.kind === "once" ? localDate(new Date(s.at), tz) : s.anchorDate;
  const time = s.kind === "once" ? shortTime(s.at, tz, language) : s.times[0];
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
    setRemainingIssues((issues) =>
      issuesAfterDraftChange(issues, { times: [hm] }),
    );
  };
  const save = async () => {
    const unresolved = unresolvedDraftMessage(remainingIssues);
    if (unresolved) {
      const localized = remainingIssues
        .map((issue) => localizeIssue(language, issue))
        .join(". ");
      setError(language === "en" ? `Fix: ${localized}` : unresolved);
      return;
    }
    const problems = validateSchedule(s);
    if (!text.trim()) problems.push("Введите текст напоминания");
    if (!next.length) problems.push("Нет будущих дат: проверьте условия");
    if (problems.length) {
      setError(problems.map((issue) => localizeIssue(language, issue)).join(". "));
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
      setError(localizeIssue(language, e.message));
    }
  };
  const list = (key, label, min, max) => (
    <label className="field">
      {label}
      <input
        value={(s[key] || []).join(", ")}
        inputMode="numeric"
        placeholder={`${min}…${max}, ${copy("commaSeparated")}`}
        onChange={(e) =>
          update({
            [key]: e.target.value.split(/[ ,]+/).filter(Boolean).map(Number),
          })
        }
      />
    </label>
  );
  return (
    <Modal
      title={initial.id ? copy("edit") : copy("newReminder")}
      closeLabel={copy("close")}
      onClose={onClose}
      wide
    >
      {initial.originalTranscript && (
        <p className="transcript">«{initial.originalTranscript}»</p>
      )}
      {queueSize > 1 && (
        <p className="notice">
          {language === "en" ? `This phrase contains ${queueSize} reminders. Each is saved as a separate rule.` : `В этой фразе найдено напоминаний: ${queueSize}. Каждое сохранится отдельным правилом.`}
        </p>
      )}
      {remainingIssues.length > 0 && (
        <p className="notice">
          {remainingIssues.map((issue) => localizeIssue(language, issue)).join(". ")}. {language === "en" ? "Check and correct the fields below." : "Проверьте и исправьте поля ниже."}
        </p>
      )}
      <label className="field">
        {copy("reminderText")}
        <textarea
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRemainingIssues((issues) =>
              issuesAfterDraftChange(issues, { text: e.target.value }),
            );
          }}
          placeholder={copy("reminderPlaceholder")}
        />
      </label>
      <div className="segmented">
        {[
          ["once", copy("once")],
          ["calendar", copy("calendar")],
          ["interval", copy("interval")],
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
          <TimeWheel value={time} language={language} onChange={setTime} />
          <label className="field">
            {s.kind === "once" ? copy("date") : copy("startDate")}
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
          {s.specificDates?.length ? (
            <>
              <label className="field">
                {copy("specificDates")}
                <input
                  value={s.specificDates.join(", ")}
                  onChange={(e) =>
                    update({
                      specificDates: e.target.value
                        .split(/[, ]+/)
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <p className="hint">
                {copy("specificDatesHint")}
              </p>
            </>
          ) : (
            <label className="field">
              {copy("repeatFrequency")}
              <Select
                value={s.frequency}
                ariaLabel={copy("repeatFrequency")}
                onChange={(value) =>
                  update({
                    frequency: value,
                    weekdays:
                      value === "weekly" && !s.weekdays.length
                        ? [1]
                        : s.weekdays,
                    monthDays:
                      ["monthly", "yearly"].includes(value) &&
                      !s.monthDays.length
                        ? [new Date().getDate()]
                        : s.monthDays,
                    months:
                      value === "yearly" && !s.months.length
                        ? [new Date().getMonth() + 1]
                        : s.months,
                  })
                }
                options={[
                  { value: "daily", label: copy("daily") },
                  { value: "weekly", label: copy("weekly") },
                  { value: "monthly", label: copy("monthly") },
                  { value: "yearly", label: copy("yearly") },
                ]}
              />
            </label>
          )}
          <label className="field">
            {copy("step")}
            <input
              type="number"
              min="1"
              max="1000"
              value={s.interval}
              onChange={(e) => update({ interval: +e.target.value })}
            />
          </label>
          {!s.specificDates?.length && <div className="weekdays" aria-label={language === "en" ? "Days of week" : "Дни недели"}>
            {(language === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]).map((w, i) => (
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
          </div>}
          {!s.specificDates?.length && <>
            {list("monthDays", copy("monthDays"), 1, 31)}
            {list("months", copy("months"), 1, 12)}
            <label className="field">
              {copy("dayParity")}
              <Select
                value={s.dayParity}
                ariaLabel={copy("dayParity")}
                onChange={(dayParity) => update({ dayParity })}
                options={[
                  { value: "any", label: copy("any") },
                  { value: "even", label: copy("even") },
                  { value: "odd", label: copy("odd") },
                ]}
              />
            </label>
            <p className="hint">
              {language === "en" ? "Days, months and parity are combined. A missing day of the month is skipped." : "Дни, числа, месяцы и чётность сочетаются вместе. Отсутствующее число месяца пропускается."}
            </p>
          </>}
        </>
      )}
      {s.kind === "interval" && (
        <>
          <label className="field">
            {copy("intervalMinutes")}
            <input
              type="number"
              min="1"
              value={s.intervalMinutes}
              onChange={(e) => update({ intervalMinutes: +e.target.value })}
            />
          </label>
          <label className="field">
            {copy("firstOccurrence")}
            <input
              type="datetime-local"
              value={
                localDate(new Date(s.startAt)) + "T" + shortTime(s.startAt, zone(), language)
              }
              onChange={(e) => {
                if (e.target.value)
                  update({ startAt: new Date(e.target.value).toISOString() });
              }}
            />
          </label>
          <div className="two">
            <label className="field">
              {copy("notBefore")}
              <input
                type="time"
                value={s.windowStart || ""}
                onChange={(e) => update({ windowStart: e.target.value })}
              />
            </label>
            <label className="field">
              {copy("notAfter")}
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
            {advanced ? copy("hide") : copy("advanced")}
          </button>
          {advanced && (
            <div className="advanced">
              {s.kind === "calendar" && (
                <>
                  <label className="field">
                    {copy("extraTimes")}
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
                    label={copy("lastDay")}
                    value={s.lastDay}
                    onChange={(v) => update({ lastDay: v, monthDays: [] })}
                  />
                  <label className="field">
                    {copy("ordinalWeekday")}
                    <Select
                      value={s.ordinal || ""}
                      ariaLabel={copy("ordinalWeekday")}
                      onChange={(value) =>
                        update({
                          ordinal: value ? +value : null,
                          weekday: s.weekday || 1,
                          monthDays: [],
                          weekdays: [],
                        })
                      }
                      options={[
                        { value: "", label: copy("unlimited") },
                        ...[1, 2, 3, 4, 5, -1].map((v) => ({
                          value: String(v),
                          label: v === -1 ? copy("last") : v + (language === "en" ? "" : "-й"),
                        })),
                      ]}
                    />
                  </label>
                  {s.ordinal && (
                    <label className="field">
                      {copy("whichDay")}
                      <Select
                        value={s.weekday}
                        ariaLabel={copy("whichDay")}
                        onChange={(value) => update({ weekday: +value })}
                        options={(language === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]).map(
                          (w, i) => ({ value: String(i + 1), label: w }),
                        )}
                      />
                    </label>
                  )}
                </>
              )}
              <div className="two">
                <label className="field">
                  {copy("untilDate")}
                  <input
                    type="date"
                    value={s.until || ""}
                    onChange={(e) => update({ until: e.target.value || null })}
                  />
                </label>
                <label className="field">
                  {copy("count")}
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
                {copy("excludeDates")}
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
                {copy("timezone")}
                <Select
                  value={s.timezoneMode}
                  ariaLabel={copy("timezone")}
                  onChange={(timezoneMode) => update({ timezoneMode })}
                  options={[
                    { value: "deviceLocal", label: copy("deviceLocal") },
                    { value: "fixed", label: copy("fixed") },
                  ]}
                />
              </label>
              {s.timezoneMode === "fixed" && (
                <label className="field">
                  {copy("iana")}
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
        <strong>{describe(s, language)}</strong>
        <small>{copy("nextOccurrences")}</small>
        {next.map((t) => (
          <span key={t}>
            {new Intl.DateTimeFormat(languageTag(language), {
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
            ? `${copy("quotaExhausted")} ${copy("open")}.`
            : error}
        </p>
      )}
      <button
        className="primary full"
        disabled={busy || remainingIssues.length > 0}
        onClick={save}
      >
        {busy ? copy("saving") : copy("saveButton")}
      </button>
    </Modal>
  );
}
