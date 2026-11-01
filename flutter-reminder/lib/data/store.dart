// lib/data/store.dart — SQLite-хранилище напоминаний и настроек.
//
// Этап 3 плана. Главная архитектурная правка относительно React-версии:
// данные больше не живут в localStorage WebView (при очистке кэша Android
// пользователи теряли напоминания). Теперь — обычная SQLite-БД приложения,
// которая попадает в автобэкап Android и не чистится вместе с кэшем.
//
// Таблицы:
//   reminders — модель Reminder (см. domain/reminder.dart, toRow/fromRow);
//   settings  — key/value: статус PRO (paidUntil), id последнего запущенного
//               будильника и пр.
//
// Все операции — асинхронные (sqflite работает на отдельном изоляте-потоке),
// UI не дёргается при сохранении.

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../domain/reminder.dart';

class Store {
  static const _dbName = 'remindme.db';
  static const _dbVersion = 1;

  Database? _db;

  Future<Database> get _database async {
    if (_db != null) return _db!;
    final dir = await getDatabasesPath();
    _db = await openDatabase(
      p.join(dir, _dbName),
      version: _dbVersion,
      onCreate: (db, v) async {
        await db.execute('''
          CREATE TABLE reminders (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            when_ms INTEGER NOT NULL,
            repeats INTEGER NOT NULL DEFAULT 0,
            repeat_every_min INTEGER NOT NULL DEFAULT 0,
            done INTEGER NOT NULL DEFAULT 0,
            notification_id INTEGER NOT NULL DEFAULT 0
          )
        ''');
        await db.execute(
            'CREATE INDEX idx_reminders_when ON reminders (when_ms)');
        await db.execute('''
          CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        ''');
      },
    );
    return _db!;
  }

  Future<void> close() async {
    await _db?.close();
    _db = null;
  }

  // ---------------- reminders ----------------

  /// Все невыполненные напоминания, отсортированные по времени срабатывания.
  Future<List<Reminder>> activeReminders() async {
    final db = await _database;
    final rows =
        await db.query('reminders', where: 'done = 0', orderBy: 'when_ms ASC');
    return rows.map(Reminder.fromRow).toList();
  }

  /// Все напоминания, включая выполненные (для истории/отладки).
  Future<List<Reminder>> allReminders() async {
    final db = await _database;
    final rows = await db.query('reminders', orderBy: 'when_ms ASC');
    return rows.map(Reminder.fromRow).toList();
  }

  Future<Reminder?> reminderById(String id) async {
    final db = await _database;
    final rows = await db
        .query('reminders', where: 'id = ?', whereArgs: [id], limit: 1);
    if (rows.isEmpty) return null;
    return Reminder.fromRow(rows.first);
  }

  /// Вставка или замена записи (upsert по id). Возвращает сохранённую запись.
  Future<Reminder> saveReminder(Reminder r) async {
    final db = await _database;
    await db.insert('reminders', r.toRow(),
        conflictAlgorithm: ConflictAlgorithm.replace);
    return r;
  }

  Future<void> markDone(String id) async {
    final db = await _database;
    await db.update('reminders', {'done': 1}, where: 'id = ?', whereArgs: [id]);
  }

  Future<void> deleteReminder(String id) async {
    final db = await _database;
    await db.delete('reminders', where: 'id = ?', whereArgs: [id]);
  }

  /// Количество активных напоминаний — нужно для freemium-лимита
  /// (canCreateReminder в domain/access.dart).
  Future<int> activeCount() async {
    final db = await _database;
    final res = await db
        .rawQuery('SELECT COUNT(*) AS c FROM reminders WHERE done = 0');
    return (res.first['c'] as num?)?.toInt() ?? 0;
  }

  // ---------------- settings ----------------

  Future<String?> getSetting(String key) async {
    final db = await _database;
    final rows = await db
        .query('settings', where: 'key = ?', whereArgs: [key], limit: 1);
    if (rows.isEmpty) return null;
    return rows.first['value'] as String?;
  }

  Future<void> setSetting(String key, String? value) async {
    final db = await _database;
    await db.insert('settings', {'key': key, 'value': value},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Статус PRO хранится как epoch-мс в paid_until. Клиентская часть —
  /// только кэш: настоящим источником истины является billing-server
  /// (проверка подписки RuStore на сервере), чтобы лимиты нельзя было
  /// обойти правкой БД.
  Future<int> paidUntil() async =>
      int.tryParse(await getSetting('paid_until') ?? '') ?? 0;

  Future<void> setPaidUntil(int ms) => setSetting('paid_until', '$ms');
}
