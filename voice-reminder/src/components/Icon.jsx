// components/Icon.jsx — набор иконок интерфейса.
//
// Иконки заданы SVG-путями прямо в коде, без внешних файлов и зависимостей:
// приложение работает офлайн (в том числе в APK), поэтому грузить иконки
// по сети нельзя.
import React from "react";

const PATHS = {
  mic: "M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  settings: [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  ],
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  bell: "M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3ZM10 21h4",
  check: "M5 12l4 4L19 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 18l-6-6 6-6",
  stop: "M6 6h12v12H6Z",
  edit: "M4 20l4-1L20 7l-3-3L5 16Z",
  trash: "M4 6h16M9 3h6M7 6l1 15h8l1-15M10 10v7M14 10v7",
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
      {(Array.isArray(paths[name]) ? paths[name] : [paths[name] || paths.bell]).map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
