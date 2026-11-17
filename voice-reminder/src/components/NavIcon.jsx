// components/NavIcon.jsx — иконка нижней навигации (дом / события / настройки).
//
// Отдельная от components/Icon.jsx: у навигации крупнее размер и всегда
// залитый контур, тогда как Icon рисует тонкие линии 1.7.
import React from "react";

export default function NavIcon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="23"
      height="23"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path
        d={
          name === "home"
            ? "M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10"
            : name === "events"
              ? "M5 4h14v17H5ZM8 2v5M16 2v5M5 9h14M8 13h3M8 17h7"
              : "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z"
        }
      />
    </svg>
  );
}
