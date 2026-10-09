import React, { useRef, useEffect } from "react";
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
function Day({ date, today, selected, segments, onDate, onOpenDay }) {
  const press = useRef({ timer: null, long: false, cancelled: false });
  const clear = () => clearTimeout(press.current.timer);
  useEffect(() => () => clearTimeout(press.current.timer), []);
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
      aria-pressed={selected}
      aria-describedby="calendar-gestures"
      title={`${label(date)} · ${segments.length} событий. Удерживайте для просмотра.`}
      data-event-count={segments.length}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        clear();
        press.current = {
          x: e.clientX,
          y: e.clientY,
          long: false,
          cancelled: false,
          timer: setTimeout(() => {
            press.current.long = true;
            onOpenDay(date);
          }, 600),
        };
      }}
      onPointerMove={(e) => {
        if (
          Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) >
          10
        ) {
          clear();
          press.current.cancelled = true;
        }
      }}
      onPointerUp={clear}
      onPointerCancel={() => {
        clear();
        press.current.cancelled = true;
      }}
      onClick={(e) => {
        if (press.current.long || press.current.cancelled) {
          e.preventDefault();
          press.current.long = false;
          press.current.cancelled = false;
          return;
        }
        onDate(date);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        clear();
        if (!press.current.long) onOpenDay(date);
        press.current.long = true;
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.shiftKey) {
          e.preventDefault();
          press.current.long = true;
          onOpenDay(date);
        }
      }}
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
  onOpenDay,
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
    <section className="month-card" aria-label="Календарь">
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
              onOpenDay={onOpenDay}
            />
          ) : (
            <span key={"empty" + i} />
          ),
        )}
      </div>
      <span className="sr-only" id="calendar-gestures">
        Короткое нажатие выбирает дату. Удерживайте или нажмите Shift и Enter
        для просмотра событий дня.
      </span>
    </section>
  );
}
