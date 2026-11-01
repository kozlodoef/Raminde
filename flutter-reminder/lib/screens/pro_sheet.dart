// lib/screens/pro_sheet.dart — экран апгрейда до PRO (подписка RuStore).
//
// Этап 6 плана (UI). Важно для модерации RuStore:
//   - цена и период подписки указаны до нажатия кнопки покупки;
//   - кнопка «Восстановить покупку» обязательна (политика магазинов);
//   - покупка верифицируется на billing-server, а не «на глаз».
//
// Интеграция с RuStore SDK выполняется через MethodChannel 'rystore_billing'
// (нативный Kotlin-модуль android/app/src/main/kotlin/.../RystoreBillingPlugin.kt —
// см. этап сборки). Здесь — контракт вызова и UI.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../providers/reminder_controller.dart';

const _rystore = MethodChannel('rystore_billing');

class ProSheet extends StatefulWidget {
  final ReminderController controller;
  final String? note;
  const ProSheet({super.key, required this.controller, this.note});

  @override
  State<ProSheet> createState() => _ProSheetState();
}

class _ProSheetState extends State<ProSheet> {
  bool _busy = false;
  String? _error;

  static const _productId = 'pro_month'; // товар из каталога RuStore

  Future<void> _buy() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // 1) нативный запуск экрана оплаты RuStore; возвращает purchase token
      final token = await _rystore.invokeMethod<String>(
        'purchase',
        {'productId': _productId},
      );
      if (token == null || token.isEmpty) {
        throw Exception('Покупка отменена');
      }
      // 2) серверная верификация токена — источник истины о статусе PRO
      await widget.controller.proAccess.verifyPurchase(_productId, token);
      await widget.controller.refreshAccess();
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Спасибо! PRO активирован 🎉')),
      );
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = 'RuStore: ${e.message ?? e.code}');
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _restore() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _rystore.invokeMethod('restorePurchases');
      await widget.controller.refreshAccess();
      if (!mounted) return;
      if (widget.controller.isPro) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Подписка восстановлена')),
        );
      } else {
        setState(() => _error = 'Активных подписок не найдено.');
      }
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = 'RuStore: ${e.message ?? e.code}');
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Напомни мне PRO',
              style: Theme.of(context).textTheme.titleLarge),
          if (widget.note != null) ...[
            const SizedBox(height: 8),
            Text(widget.note!,
                style: Theme.of(context).textTheme.bodyMedium),
          ],
          const SizedBox(height: 16),
          const _ProFeature(Icons.all_inclusive, 'Безлимит напоминаний'),
          const _ProFeature(Icons.repeat, 'Повторы по расписанию'),
          const _ProFeature(Icons.pets, 'Кастомные звуки уведомлений (v1.1)'),
          const SizedBox(height: 16),
          if (widget.controller.isPro)
            FilledButton.tonal(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Вы уже в PRO — спасибо!'),
            )
          else ...[
            Text(
              'Подписка ₽149/мес. Отменяется в один тап в RuStore → Подписки.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy ? null : _buy,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.shopping_cart_checkout),
              label: const Text('Оформить PRO'),
            ),
            TextButton(
              onPressed: _busy ? null : _restore,
              child: const Text('Восстановить покупку'),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
    );
  }
}

class _ProFeature extends StatelessWidget {
  final IconData icon;
  final String text;
  const _ProFeature(this.icon, this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
