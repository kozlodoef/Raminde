import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles.css";
import "./theme-fonts.css";
import "./theme.css";
import "./focus-home.css";
import { watchViewportHeight } from "./lib/viewport-height.js";

// Высота приложения считается по видимой области, а не по окну. На телефоне
// при открытой клавиатуре окно не меняется, а видимая область уменьшается;
// без этого календарь уезжал под клавиатуру (см. focus-home.css).
watchViewportHeight();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);