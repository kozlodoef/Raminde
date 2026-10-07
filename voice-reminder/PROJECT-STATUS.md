# Статус проекта

Текущая разработка версии 2: см. [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

Исторический аудит первоначального состояния приведён в корневом [PROJECT-TASK.md](../PROJECT-TASK.md). Старые Windows-пути, утверждения о конкретной локальной APK и количестве отслеживаемых node_modules больше не используются как актуальная инструкция.

Команды:

```sh
npm ci
npm test
npm run build
npx cap sync android
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

Для сервера российского эквайринга: `cd billing-server && npm test` из корня проекта; см. его README. Реальные платежи до настройки магазина отключены.
