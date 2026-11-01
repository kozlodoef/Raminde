// lib/main.dart — точка входа Flutter-версии «Напомни мне».
//
// Этап 5-6 плана: связываем домен, SQLite, уведомления и UI.
//
// Порядок старта (важно для надёжности будильников):
//   1. WidgetsFlutterBinding — нужен до вызова любых плагинов;
//   2. NotificationService.init() — канал + права;
//   3. ReminderController.bootstrap() — PRO-статус с billing-server, загрузка
//      напоминаний из SQLite, перепостановка алармов, показ просроченных.

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/store.dart';
import 'providers/reminder_controller.dart';
import 'screens/home_screen.dart';
import 'services/notifications.dart';
import 'services/pro_access.dart';

/// Адрес billing-server (HTTPS обязателен по политике RuStore и Android
/// cleartext-policy). Подставьте боевой домен перед сборкой релиза.
const billingBaseUrl = String.fromEnvironment(
  'BILLING_URL',
  defaultValue: 'https://billing.example.ru',
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RemindMeApp());
}

class RemindMeApp extends StatefulWidget {
  const RemindMeApp({super.key});

  @override
  State<RemindMeApp> createState() => _RemindMeAppState();
}

class _RemindMeAppState extends State<RemindMeApp> {
  late final Store store;
  late final ReminderController controller;

  @override
  void initState() {
    super.initState();
    store = Store();
    controller = ReminderController(
      store: store,
      notifications: NotificationService(),
      proAccess: ProAccessService(store: store, baseUrl: billingBaseUrl),
    );
    controller.bootstrap();
  }

  @override
  void dispose() {
    controller.dispose();
    store.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Напомни мне',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      locale: const Locale('ru'),
      supportedLocales: const [Locale('ru'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: HomeScreen(controller: controller),
    );
  }
}
