// lib/native.js — платформенные различия в одном месте.
//
// Приложение живёт в двух средах:
//   • браузер (Chrome/Safari) — микрофон через Web Speech API, напоминания таймерами;
//   • Android через Capacitor — микрофон нативный, напоминания через AlarmManager.
//
// Пакеты Capacitor подгружаются ДИНАМИЧЕСКИ и только когда мы действительно
// внутри нативной оболочки. Иначе веб-сборка тянула бы нативные модули, а
// статический импорт упал бы в браузере.

let nativePromise = null;

/** Запущено ли приложение внутри нативной оболочки (Android/iOS). */
export function isNative() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // В вебе Capacitor тоже может присутствовать, поэтому проверяем платформу.
  const platform = cap.getPlatform ? cap.getPlatform() : cap.platform;
  if (platform && platform !== 'web') return true;
  return !!cap.isNativePlatform;
}

/** Имя платформы: 'android' | 'ios' | 'web'. */
export function platformName() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return 'web';
  return (cap.getPlatform ? cap.getPlatform() : cap.platform) || 'web';
}

/**
 * Достаёт нативный плагин Capacitor по имени регистрации.
 * Возвращает null в браузере и при ошибке — вызывающий код должен уметь
 * откатиться на веб-реализацию, а не падать.
 */
export async function getPlugin(registeredName) {
  if (!isNative()) return null;
  if (!nativePromise) nativePromise = import('@capacitor/core');
  try {
    const core = await nativePromise;
    return core.registerPlugin(registeredName);
  } catch (e) {
    console.warn('Нативный плагин недоступен:', registeredName, e);
    return null;
  }
}

/** Момент срабатывания → метка времени, либо null если значение непригодно. */
export function toTime(when) {
  if (when === null || when === undefined) return null;
  if (when instanceof Date) {
    const t = when.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof when === 'string' || typeof when === 'number') {
    if (typeof when === 'string' && when.trim() === '') return null;
    const t = new Date(when).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
