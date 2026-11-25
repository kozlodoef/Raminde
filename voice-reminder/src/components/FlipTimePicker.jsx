// components/FlipTimePicker.jsx — редактирование времени перекидными цифрами.
//
// Каждая цифра — «карточка» механического табло: при смене значения старая
// цифра откидывается вниз, новая докидывается следом. Звук — тот же
// короткий щелчок, что и в остальной программе. Цифры меняются маленькими
// стрелками под и над карточкой: не нужно задумываться, куда тянуть, и не
// приходится прокручивать лишние значения, как на колесе.
//
// Ограничения встроены: час не выходит за 23, минуты за 59, «24:00»
// получить нельзя.

import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { playUiSound } from "../lib/ui-sounds.js";
import {
  parseTimeDigits,
  stepTimeDigit,
  formatTimeDigits,
} from "../lib/flip-time.js";

const NAMES = ["десятки часов", "единицы часов", "десятки минут", "единицы минут"];

/**
 * Карточка одной цифры.
 *
 * Анимация: поверх текущей цифры на 0.17 с откидывается старое значение,
 * затем из-за верхнего края докидывается новое. Базовый слой сразу
 * показывает новое значение — без него между фазами видна бы дырка.
 */
function FlipDigit({ value }) {
  const [shown, setShown] = useState(value);
  const [anim, setAnim] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (value === shown) return;
    setAnim({ from: shown, to: value });
    setShown(value);
    timer.current = setTimeout(() => setAnim(null), 350);
    return () => clearTimeout(timer.current);
  }, [value]);

  return (
    <div className="flip-digit" aria-hidden="true">
      <span>{shown}</span>
      {anim && (
        <>
          <span className="flip-out">{anim.from}</span>
          <span className="flip-in">{anim.to}</span>
        </>
      )}
    </div>
  );
}

export default function FlipTimePicker({
  value,
  onChange,
  onDone,
  onCancel,
  soundEnabled = true,
  note,
}) {
  const [digits, setDigits] = useState(() => parseTimeDigits(value));

  // Синхронизация с внешним значением: карточку можно закрыть и открыть
  // снова, и тогда время берётся из сохранённого черновика.
  useEffect(() => {
    setDigits(parseTimeDigits(value));
  }, [value]);

  function step(i, dir) {
    const nd = stepTimeDigit(digits, i, dir);
    setDigits(nd);
    onChange(formatTimeDigits(nd));
    playUiSound("tick", { enabled: soundEnabled });
  }

  return (
    <div className="flip-picker">
      {/* Пояснение нужно там, где правка затрагивает не один день: человек
          должен видеть это до нажатия «Готово», а не после. */}
      {note && <p className="flip-note">{note}</p>}
      <div className="flip-row">
        {digits.map((d, i) => (
          <React.Fragment key={i}>
            {i === 2 && (
              <span className="flip-colon" aria-hidden="true">
                :
              </span>
            )}
            <div className="flip-col">
              <button
                type="button"
                className="flip-step"
                aria-label={NAMES[i] + " — увеличить"}
                onClick={() => step(i, 1)}
              >
                <Icon name="chev-up" size={14} />
              </button>
              <FlipDigit value={d} />
              <button
                type="button"
                className="flip-step"
                aria-label={NAMES[i] + " — уменьшить"}
                onClick={() => step(i, -1)}
              >
                <Icon name="chev-down" size={14} />
              </button>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="flip-actions">
        <button className="flip-done" onClick={onDone}>
          Готово
        </button>
        <button className="flip-cancel" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
