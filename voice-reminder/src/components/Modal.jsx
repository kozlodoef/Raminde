// components/Modal.jsx — модальное окно с доступностью.
//
// Здесь сосредоточено то, что легко забыть в каждом отдельном экране:
// перехват Escape, удержание фокуса внутри окна (Tab/Shift+Tab по кругу)
// и возврат фокуса на прежнее место после закрытия.
import React, { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

export default function Modal({
  title,
  children,
  onClose,
  wide = false,
  closeLabel = "Закрыть",
  className = "",
  style,
}) {
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
        className={["sheet", wide ? "wide" : "", className].filter(Boolean).join(" ")}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          {onClose && (
            <button
              className="icon-button"
              aria-label={closeLabel}
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
