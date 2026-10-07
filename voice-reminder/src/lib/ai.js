// lib/ai.js — оставлен для совместимости.
//
// Логика распознавания переехала в lib/speech.js, потому что теперь у неё две
// реализации: Web Speech API в браузере и нативный плагин на Android.
// Этот модуль просто переадресует вызовы, чтобы не ломать старые импорты.
export {
  isVoiceSupported,
  startRecognition,
  demoPhrase,
  hasMicPermission,
  requestMicPermission,
} from './speech.js';
