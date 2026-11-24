// components/Icon.jsx — иконки интерфейса.
//
// Пути заданы прямо в коде, без внешних файлов: приложение работает офлайн,
// в том числе внутри APK, поэтому иконки нельзя грузить по сети.
//
// Раньше эта функция жила внутри ReminderControls.jsx вместе с редактором
// напоминаний на 430 строк, из-за чего файл было тяжело читать.
import React from "react";

const PATHS = {
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
  "chev-up": "M6 15l6-6 6 6",
  "chev-down": "M6 9l6 6 6-6",
};

export default function Icon({ name, size = 24 }) {
  const paths = PATHS;
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
