// lib/screens/home_screen.dart — главный экран: список напоминаний + микрофон.
//
// Этап 5 плана (UI). Порт App.jsx из React-версии, но упрощённый: вместо
// вкладок и модалок — один экран + bottom sheet для ручного ввода.

import 'package:flutter/material.dart';

import '../domain/reminder.dart';
import '../providers/reminder_controller.dart';
import 'add_sheet.dart';
import 'pro_sheet.dart';

String formatWhen(DateTime d) {
  final now = DateTime.now();
  String two(num n) => n.toInt().toString().padLeft(2, '0');
  final time = '${two(d.hour)}:${two(d.minute)}';
  if (d.year == now.year &&
      d.month == now.month &&
      d.day == now.day) {
    return 'сегодня, $time';
  }
  final tomorrow = now.add(const Duration(days: 1));
  if (d.year == tomorrow.year && d.month == tomorrow.month && d.day == tomorrow.day) {
    return 'завтра, $time';
  }
  return '${two(d.day)}.${two(d.month)}.${d.year}, $time';
}

class HomeScreen extends StatelessWidget {
  final ReminderController controller;
  const HomeScreen({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Напомни мне'),
            actions: [
              if (!controller.isPro)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Center(
                    child: Text(
                      '${controller.reminders.length}/3',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                )
              else
                const Chip(label: Text('PRO'), visualDensity: VisualDensity.compact),
              IconButton(
                tooltip: 'Купить PRO',
                icon: const Icon(Icons.workspace_premium_outlined),
                onPressed: () => showModalBottomSheet(
                  context: context,
                  showDragHandle: true,
                  isScrollControlled: true,
                  builder: (_) => ProSheet(controller: controller),
                ),
              ),
            ],
          ),
          body: controller.busy
              ? const Center(child: CircularProgressIndicator())
              : controller.reminders.isEmpty
                  ? _EmptyState(onAdd: () => _openAdd(context))
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                      itemCount: controller.reminders.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, i) =>
                          _ReminderTile(controller: controller, r: controller.reminders[i]),
                    ),
          floatingActionButton: FloatingActionButton(
            onPressed: () => _openAdd(context),
            tooltip: 'Добавить напоминание',
            child: const Icon(Icons.mic),
          ),
        );
      },
    );
  }

  void _openAdd(BuildContext context) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => AddSheet(controller: controller),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onAdd;
  const _EmptyState({required this.onAdd});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.alarm, size: 64, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text(
              'Скажите: «Напомни завтра в семь утра полить цветы»',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Или нажмите кнопку ниже, чтобы ввести текст вручную.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add),
              label: const Text('Первое напоминание'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReminderTile extends StatelessWidget {
  final ReminderController controller;
  final Reminder r;
  const _ReminderTile({required this.controller, required this.r});

  @override
  Widget build(BuildContext context) {
    final overdue = r.when.isBefore(DateTime.now());
    return Card(
      child: ListTile(
        leading: Icon(
          overdue ? Icons.warning_amber_rounded : Icons.alarm_on,
          color: overdue ? Colors.orange : Theme.of(context).colorScheme.primary,
        ),
        title: Text(r.text),
        subtitle: Text(
          formatWhen(r.when) +
              (r.repeats > 0
                  ? ' · повтор ×${r.repeats} через ${r.repeatEveryMin >= 60 ? '${r.repeatEveryMin ~/ 60} ч' : '${r.repeatEveryMin} мин'}'
                  : ''),
        ),
        trailing: IconButton(
          icon: const Icon(Icons.check_circle_outline),
          tooltip: 'Выполнено',
          onPressed: () => controller.complete(r.id),
        ),
        onTap: () {},
      ),
    );
  }
}
