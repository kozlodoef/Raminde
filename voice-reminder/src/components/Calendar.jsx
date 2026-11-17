// components/Calendar.jsx — календарь месяца с отметками напоминаний.
//
// Сложность здесь в двух вещах:
//  1) напоминания бывают разовые, повторяющиеся и по выбранным датам —
//     поэтому для каждой даты считается свой список срабатываний;
//  2) вокруг дня рисуется кольцо из секторов, по сектору на напоминание,
//     цвет берётся стабильным хешем id (иначе цвета «прыгали» бы при
//     каждой перерисовке).
import React, { useEffect, useRef, useState } from "react";
import {
  localDate,
  nextOccurrences,
  pad,
  zone,
  zonedTime,
} from "../domain/calendar.js";
import {
  reminderTimesOnDate,
  stableReminderColor,
  shiftCalendarMonth,
} from "../domain/interaction.js";
import { languageTag } from "../domain/i18n.js";

export default function Calendar({
  reminders,
  selectedDate,
  draftDates = [],
  creating = false,
  language = "ru",
  onSelect,
  onToggleDate,
  onLongPress,
}) {
  const today = localDate();
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const [displayMonth, setDisplayMonth] = useState((selectedDate || today).slice(0, 7));
  const [year, month] = displayMonth.split("-").map(Number);
  useEffect(() => {
    setDisplayMonth((selectedDate || today).slice(0, 7));
  }, [selectedDate]);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const dates = Array.from({ length: leading + daysInMonth }, (_, index) => {
    if (index < leading) return null;
    return `${year}-${pad(month)}-${pad(index - leading + 1)}`;
  });
  const eventsByDate = new Map();
  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    const schedule = reminder.schedule;
    const tz = schedule.timezoneMode === "fixed" ? schedule.timezone : zone();
    const occurrences = reminderTimesOnDate(reminder, `${year}-${pad(month)}-01`).length
      ? Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${year}-${pad(month)}-${pad(i + 1)}`;
          return reminderTimesOnDate(reminder, date).map((when) => ({ when, date }));
        }).flat()
      : schedule.kind === "once"
        ? [new Date(schedule.at).getTime()].filter((when) => Number.isFinite(when))
            .map((when) => ({ when, date: localDate(new Date(when), tz) }))
        : nextOccurrences(
            schedule,
            zonedTime(`${year}-${pad(month)}-01`, "00:00", tz) - 1,
            Math.max(31, daysInMonth * 4),
          ).map((when) => ({ when, date: localDate(new Date(when), tz) }));
    for (const { when, date } of occurrences) {
      if (date.slice(0, 7) !== `${year}-${pad(month)}`) continue;
      const current = eventsByDate.get(date) || [];
      if (!current.some((item) => item.reminder.id === reminder.id && item.when === when)) {
        current.push({ reminder, when, timezone: tz });
        eventsByDate.set(date, current);
      }
    }
  }
  const title = new Intl.DateTimeFormat(languageTag(language), {
    month: "long",
    year: "numeric",
  }).format(first);
  const selectDate = (date) => {
    setDisplayMonth(date.slice(0, 7));
    onSelect(date);
  };
  const shiftMonth = (delta) => {
    setDisplayMonth(shiftCalendarMonth(displayMonth, delta));
  };
  const startPress = (date) => {
    clearTimeout(pressTimer.current);
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPress?.(date);
    }, 550);
  };
  const endPress = () => clearTimeout(pressTimer.current);
  return (
    <section className="calendar" aria-label={language === "en" ? "Reminder calendar" : "Календарь напоминаний"}>
      <header className="calendar-header">
        <button className="icon-button" aria-label={language === "en" ? "Previous month" : "Предыдущий месяц"} onClick={() => shiftMonth(-1)}>‹</button>
        <h2>{title[0].toUpperCase() + title.slice(1)}</h2>
        <button className="icon-button" aria-label={language === "en" ? "Next month" : "Следующий месяц"} onClick={() => shiftMonth(1)}>›</button>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {(language === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]).map((name) => <span key={name}>{name}</span>)}
      </div>
      <div className="calendar-grid">
        {dates.map((date, index) => date ? (
          <button
            key={date}
            className={[date === selectedDate ? "selected" : "", draftDates.includes(date) ? "draft-selected" : "", date === today ? "today" : "", [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? "weekend" : ""].filter(Boolean).join(" ")}
            aria-label={`${date}${eventsByDate.has(date) ? (language === "en" ? `, ${eventsByDate.get(date).length} reminders` : `, ${eventsByDate.get(date).length} напоминаний`) : ""}`}
            aria-pressed={draftDates.includes(date)}
            onPointerDown={() => startPress(date)}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => {
              endPress();
              if (!longPressed.current) {
                selectDate(date);
                if (creating) onToggleDate?.(date);
                else onLongPress?.(date);
              }
              longPressed.current = false;
            }}
          >
            <span>{Number(date.slice(-2))}</span>
            {eventsByDate.has(date) && (() => {
              const events = eventsByDate.get(date);
              const segment = 360 / events.length;
              const gap = Math.min(7, segment * 0.08);
              const radius = 17;
              const center = 20;
              const point = (angle) => {
                const radians = ((angle - 90) * Math.PI) / 180;
                return [center + radius * Math.cos(radians), center + radius * Math.sin(radians)];
              };
              return (
                <svg className="event-ring" viewBox="0 0 40 40" aria-hidden="true">
                  {events.map(({ reminder }, index) => {
                    const [startX, startY] = point(index * segment + gap / 2);
                    const [endX, endY] = point((index + 1) * segment - gap / 2);
                    const largeArc = segment - gap > 180 ? 1 : 0;
                    return (
                      <path
                        key={`${reminder.id}-${index}`}
                        d={`M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`}
                        stroke={stableReminderColor(reminder.id, reminder.colorIndex)}
                      />
                    );
                  })}
                </svg>
              );
            })()}
          </button>
        ) : <span className="calendar-empty" key={`empty-${index}`} />)}
      </div>
    </section>
  );
}
