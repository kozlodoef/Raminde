# Сборка и публикация в RuStore (Flutter-версия)

## 1. Подготовка окружения (на вашей машине — здесь Flutter SDK недоступен)
```bash
flutter --version            # >= 3.24
cd flutter-reminder
flutter create --org ru.vremya --project-name ru_vremya_remindme . --platforms=android
flutter pub get
dart run test/run_dart_tests.dart   # доменные тесты, ожидаем 51 passed
flutter test                          # полный набор (парсер + domain)
```
`flutter create .` дополнит проект каталогами android/, gradle-обвязкой и res/
(файлы, которые мы уже написали вручную, не будут перезаписаны, кроме template-файлов).

## 2. RuStore Billing SDK
В `android/settings.gradle.kts` добавить репозиторий:
```kotlin
dependencyResolutionManagement {
  repositories {
    google(); mavenCentral()
    maven("https://artifactory-external1.rustoreinfra.ru/artifactory/rustore-public")
  }
}
```
В `android/app/build.gradle.kts`:
```kotlin
dependencies {
  implementation("ru.rustore.sdk:billing-client:0.3.7")
}
android {
  defaultConfig { applicationId = "ru.vremya.remindme"; minSdk = 23; targetSdk = 34 }
  buildTypes {
    release {
      isMinifyEnabled = true          // R8 — требование производительности APK
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName("release")
    }
  }
  signingConfigs {
    create("release") { /* key.properties из secure storage, НЕ в git */ }
  }
}
```
`proguard-rules.pro`:
```
-keep class ru.rustore.sdk.** { *; }
-keep class com.dexterous.** { *; }
```

## 3. Голосовая модель Vosk
Скачать `vosk-model-small-ru-0.22` (~45 МБ) с alphacephei.com,
распаковать в `assets/models/vosk-model-small-ru-0.22/` (pubspec уже подключает assets/models/).
Модель on-device → приложение работает без интернета и без Google Play Services
(критично для Huawei/Honor — аудитория RuStore).

## 4. BILLING_URL
Перед сборкой задать адрес вашего billing-server:
```bash
flutter build appbundle --release --dart-define=BILLING_URL=https://billing.yourdomain.ru
flutter build apk --release --split-debug-info=debug-symbols --obfuscate \
  --dart-define=BILLING_URL=https://billing.yourdomain.ru
```

## 5. Чек-лист модерации RuStore
- [ ] Подписанный релизный APK/AAB, versionCode++ при каждой загрузке
- [ ] Политика конфиденциальности на публичном URL (152-ФЗ: ПДн не собираем;
      аудио обрабатывается локально; device_id генерируется на устройстве)
- [ ] Согласие пользователя на обработку данных показывается при первом запуске
- [ ] Разрешения объяснены в UI перед запросом (микрофон — «для голосового ввода»)
- [ ] Цена подписки видна ДО покупки; есть «Восстановить покупку» (сделано)
- [ ] Тестовые аккаунты/инструкции для проверяющих (если есть закрытая часть)
- [ ] Иконка 512x512, скриншоты ≥ 3, описание без superlative-гарантий
- [ ] Работоспособность на устройстве БЕЗ Google Play Services (проверить!)
- [ ] Уведомления приходят после перезагрузки телефона (BOOT receiver — сделано)

## 6. Что осталось сделать на реальном стенде
- Проверить точные алармы на Xiaomi/Huawei (battery-optimization whitelist-диалог).
- Прогнать `flutter test` полностью (в этой среде только Dart SDK, нет Flutter).
- Подписать APK вашим ключом разработчика RuStore.
