import React, { useRef } from "react";
import { monthBounds } from "./domain/groups.js";
import { localDate, pad } from "./domain/calendar.js";
import { daySegments, MAX_DAILY_EVENTS } from "./domain/day-capacity.js";
const label = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(d + "T12:00:00"),
  );
function shift(month, step) {
  const [y, m] = month.split("-").map(Number),
    d = new Date(y, m - 1 + step, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
function Day({ date, today, selected, segments, onDate, selecting }) {
  const press = useRef({ cancelled: false });
  const n = Math.min(segments.length, MAX_DAILY_EVENTS),
    perimeter = 2 * Math.PI * 20;
  return (
    <button
      className={
        "day ring-day " +
        (selected ? "selected " : "") +
        (date === today ? "today" : "")
      }
      aria-label={label(date)}
      aria-pressed={selecting ? selected : undefined}
      aria-describedby="calendar-gestures"
      title={`${label(date)} · ${segments.length} событий. ${selecting ? "Выбрать дату" : "Открыть события дня"}.`}
      data-event-count={segments.length}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        press.current = { x: e.clientX, y: e.clientY, cancelled: false };
      }}
      onPointerMove={(e) => {
        if (
          Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) >
          10
        )
          press.current.cancelled = true;
      }}
      onPointerCancel={() => {
        press.current.cancelled = true;
      }}
      onClick={(e) => {
        if (press.current.cancelled) {
          e.preventDefault();
          press.current.cancelled = false;
          return;
        }
        onDate(date);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") press.current.cancelled = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {n > 0 && (
        <svg className="day-ring" viewBox="0 0 48 48" aria-hidden="true">
          {segments.slice(0, MAX_DAILY_EVENTS).map((s, i) => {
            const arc = perimeter / n,
              gap = n === 1 ? 0 : Math.min(0.9, arc * 0.12);
            return (
              <circle
                key={s.id}
                cx="24"
                cy="24"
                r="20"
                fill="none"
                stroke={s.color}
                strokeWidth={s.pending ? 2.6 : 3.5}
                opacity={s.pending ? 0.72 : 1}
                strokeDasharray={`${arc - gap} ${perimeter - arc + gap}`}
                strokeDashoffset={-i * arc}
                transform="rotate(-90 24 24)"
              />
            );
          })}
        </svg>
      )}
      <span className="date-number">{+date.slice(-2)}</span>
      {selected && <i className="draft-selection" aria-hidden="true" />}
      {segments.length > MAX_DAILY_EVENTS && (
        <small className="day-overflow">+</small>
      )}
    </button>
  );
}
export default function Calendar({
  month,
  onMonth,
  dates,
  onDate,
  selecting,
  occurrences,
  color,
  draftId,
}) {
  const bounds = monthBounds(month),
    today = localDate();
  const days = Array.from({ length: bounds.offset + bounds.days }, (_, i) =>
    i < bounds.offset ? null : month + "-" + pad(i - bounds.offset + 1),
  );
  return (
    <section
      className="month-card"
      aria-label="Календарь"
      data-mode={selecting ? "select" : "browse"}
    >
      <header>
        <button
          className="icon-button"
          aria-label="Предыдущий месяц"
          onClick={() => onMonth(shift(month, -1))}
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
          className="icon-button"
          aria-label="Следующий месяц"
          onClick={() => onMonth(shift(month, 1))}
        >
          ›
        </button>
      </header>
      <div className="weekdays">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="days">
        {days.map((d, i) =>
          d ? (
            <Day
              key={d}
              date={d}
              today={today}
              selected={dates.includes(d)}
              segments={daySegments(occurrences, d, { dates, color, draftId })}
              onDate={onDate}
              selecting={selecting}
            />
          ) : (
            <span key={"empty" + i} />
          ),
        )}
      </div>
      <span className="sr-only" id="calendar-gestures">
        {selecting
          ? "Создание напоминания: нажатия выбирают даты до сохранения или очистки черновика."
          : "Просмотр: нажатие открывает события выбранного дня."}
      </span>
    </section>
  );
}
