// components/ErrorBoundary.jsx — вместо белого экрана.
//
// Раньше исключение в рендере гасило всё приложение: оставался пустой
// экран без единого слова. Человек не мог ни открыть настройки, ни узнать,
// что произошло. Здесь показываются понятный текст, кнопка «Попробовать
// снова» и короткая техническая строка — по ней можно понять, что сломалось.
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Пишем в консоль: на телефоне её видно через отладку, на вебе — в
    // инструментах разработчика. Само приложение уже не падает.
    console.error("Сбой приложения:", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error);
    return (
      <main className="planner">
        <div className="planner-content">
          <section className="settings-card crash-card">
            <h1>Что-то пошло не так</h1>
            <p>
              Напоминания продолжают работать: они хранятся в телефоне, а не в
              открытом окне. Откройте приложение ещё раз, чтобы вернуться к
              списку.
            </p>
            <button
              className="primary full"
              onClick={() => this.setState({ error: null })}
            >
              Попробовать снова
            </button>
            <p className="hint crash-detail">{message}</p>
          </section>
        </div>
      </main>
    );
  }
}