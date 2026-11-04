// lib/services/pro_access.dart — проверка подписки PRO через billing-server.
//
// Этап 6 плана (часть 1). Клиент НЕ доверяет локальному статусу: при каждом
// холодном старте и перед покупкой запрашивает у billing-server валидацию
// подписки RuStore по device-ключу. Это закрывает дыру JS-версии, где trial
// сбрасывался переустановкой приложения / чисткой данных WebView.
//
// Контракт сервера (уже реализован в billing-server/):
//   GET  /api/v1/access?device=<id>        -> {"paidUntil": <ms>, "pro": bool}
//   POST /api/v1/purchase/verify           -> тело {device, productId, token}
//
// Если сервер недоступен — используем кэш из SQLite (paidUntil), но не
// продлеваем его: офлайн-режим сохраняет уже купленное, но не даёт нового.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../data/store.dart';
import '../domain/access.dart';

class ProAccessService {
  final Store store;
  final String baseUrl; // например https://billing.yourdomain.ru
  final Duration _timeout = const Duration(seconds: 8);

  ProAccessService({required this.store, required this.baseUrl});

  /// Устойчивый id устройства. Генерируется один раз и хранится в prefs;
  /// привязка подписки в billing-server идёт именно к нему (не к IMEI —
  /// сбор IMEI запрещён политикой RuStore и 152-ФЗ).
  Future<String> deviceId() async {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString('device_id');
    if (id == null) {
      id = DateTime.now().microsecondsSinceEpoch.toRadixString(36) +
          (DateTime.now().microsecond * 977 % 1000000)
              .toRadixString(36);
      await prefs.setString('device_id', id);
    }
    return id;
  }

  /// Актуальный статус доступа: сверка с сервером + фолбэк на кэш.
  Future<AccessStatus> refresh() async {
    try {
      final dev = await deviceId();
      final uri = Uri.parse('$baseUrl/api/v1/access').replace(
        queryParameters: {'device': dev},
      );
      final resp = await http.get(uri).timeout(_timeout);
      if (resp.statusCode == 200) {
        final json = jsonDecode(resp.body) as Map<String, dynamic>;
        final paidUntil = (json['paidUntil'] as num?)?.toInt() ?? 0;
        await store.setPaidUntil(paidUntil);
        return AccessStatus(paidUntil: paidUntil);
      }
    } catch (_) {
      // сеть недоступна — падаем на кэш ниже
    }
    return AccessStatus(paidUntil: await store.paidUntil());
  }

  /// Проверка покупки через RuStore-токен на сервере. Возвращает новый статус.
  Future<AccessStatus> verifyPurchase(String productId, String purchaseToken) async {
    final dev = await deviceId();
    final uri = Uri.parse('$baseUrl/api/v1/purchase/verify');
    final resp = await http
        .post(uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'device': dev,
              'productId': productId,
              'token': purchaseToken,
            }))
        .timeout(_timeout);
    if (resp.statusCode != 200) {
      throw StateError('Сервер отклонил покупку (${resp.statusCode})');
    }
    final json = jsonDecode(resp.body) as Map<String, dynamic>;
    final paidUntil = (json['paidUntil'] as num?)?.toInt() ?? 0;
    await store.setPaidUntil(paidUntil);
    return AccessStatus(paidUntil: paidUntil);
  }
}
