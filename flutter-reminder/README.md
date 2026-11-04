# Flutter-версия «Напоминание голосом» — бесплатная + PRO

Нативная реализация поверх проверенной логики React/Capacitor-версии
(`../voice-reminder`). Backend и billing-server **не меняются** — они
front-end независимы и переиспользуются как есть.

## Модель доступа (условно-бесплатная)

| | Бесплатно | PRO |
|---|---|---|
| Активных напоминаний | до 3 | без ограничений |
| Повторы | однократные | любые (интервалы, дни недели) |
| Голосовой ввод | ✓ | ✓ |
| Озвучка текста напоминания (TTS) | push-уведомление | голосом + push |

Бесплатная версия работает **вечно** — trial-модель (блокировка через 30 дней)
отменена: она ухудшает удержание. Уже созданные данные не блокируются никогда.

## Структура

```
lib/
  domain/        чистая логика, портирована из React-версии и покрыта тестами
    access.dart        freemium-лимиты (порт domain/access.js)
    reminder.dart      модель напоминания
    scheduler.dart     просроченные/повторы (порт lib/scheduler.js)
    time_parser.dart   разбор русской речи (порт lib/timeParser.js, 679 строк)
  data/          SQLite-хранилище (замена localStorage)
  services/      будильники (flutter_local_notifications), голос (Vosk on-device)
  ui/            экраны
assets/models/   модель Vosk (~50 МБ, small ru) — кладется перед сборкой
```

## Статус работ (план этапов)

- [x] Этап 1: каркас проекта, pubspec, структура
- [x] Этап 1: freemium-логика (`domain/access.dart`) — лимиты совпадают с JS-версией 1-в-1
- [ ] Этап 2: полный порт `timeParser.js` → `time_parser.dart` + перенос тестов
- [ ] Этап 3: SQLite-хранилище (`data/store.dart`)
- [ ] Этап 4: точные будильники + каналы уведомлений + обработка ребута/смены TZ
- [ ] Этап 5: голосовой ввод на Vosk (работает без Google Play Services)
- [ ] Этап 6: экран апгрейда до PRO + интеграция с billing-server
- [ ] Этап 7: AndroidManifest для RuStore (USE_EXACT_ALARM, RECORD_AUDIO), подпись APK, скриншоты

## Сборка (на машине разработчика с Flutter SDK ≥ 3.24)

```bash
cd flutter-reminder
flutter pub get
flutter test                      # перенесённые тесты парсера
flutter build apk --release       # RuStore принимает подписанный APK
```

Перед сборкой положить модель Vosk в `assets/models/` (small ru, ~50 МБ).
