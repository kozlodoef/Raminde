// ReminderControls.jsx — совместимость.
//
// Раньше в этом файле лежали все элементы управления: иконки, окно,
// переключатель, часы, колёса времени, редактор правила и экран сработавшего
// напоминания — 770 строк в одном месте.
//
// Сейчас они разложены по отдельным модулям в src/components/. Этот файл
// оставлен как реэкспорт, чтобы существующие импорты продолжали работать.
//
// Что удалено как мёртвый код:
//   • EditReminder (430 строк) — редактор заменили на голосовой ввод
//     с parseEditor и календарём, ссылок на компонент не осталось;
//   • Wheel и TimeWheel — использовались только внутри EditReminder;
//   • Clock — не использовался нигде.
export { default as Icon } from "./components/Icon.jsx";
export { default as Modal } from "./components/Modal.jsx";
export { default as Toggle } from "./components/Toggle.jsx";
export { default as AlarmBox } from "./components/AlarmBox.jsx";
