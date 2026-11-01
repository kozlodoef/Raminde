// lib/screens/add_sheet.dart — bottom sheet добавления напоминания.
//
// Два способа: голос (кнопка микрофона -> SpeechService -> time_parser) и
// ручной ввод текста + даты/времени. Freemium-лимиты показываются как апселл PRO.

import 'package:flutter/material.dart';

import '../providers/reminder_controller.dart';
import '../services/speech.dart';
import 'pro_sheet.dart';

class AddSheet extends StatefulWidget {
  final ReminderController controller;
  const AddSheet({super.key, required this.controller});

  @override
  State<AddSheet> createState() => _AddSheetState();
}

class _AddSheetState extends State<AddSheet> {
  final _textCtrl = TextEditingController();
  DateTime? _when;
  bool _listening = false;
  String? _hint;
  SpeechService? _speech;

  @override
  void dispose() {
    _textCtrl.dispose();
    _speech?.dispose();
    super.dispose();
  }

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _when ?? now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_when ?? now),
    );
    if (time == null) return;
    setState(() {
      _when = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _listen() async {
    setState(() {
      _listening = true;
      _hint = 'Слушаю… скажите фразу, например «через два часа позвонить маме»';
    });
    try {
      final speech = _speech ??= SpeechService();
      await speech.init();
      final phrase = await speech.listenOnce();
      if (!mounted) return;
      if (phrase == null || phrase.isEmpty) {
        setState(() => _hint = 'Не расслышала. Попробуйте ещё раз.');
        return;
      }
      _textCtrl.text = phrase;
      final res = await widget.controller.addFromPhrase(phrase);
      if (!mounted) return;
      switch (res.outcome) {
        case AddOutcome.created:
          Navigator.of(context).pop();
          break;
        case AddOutcome.needTime:
          setState(() => _hint =
              'Не нашла время во фразе. Укажите дату и час ниже вручную.');
          break;
        case AddOutcome.limitReached:
          _showProUpsell('В бесплатной версии можно не больше 3 напоминаний.');
          break;
        case AddOutcome.repeatBlocked:
          _showProUpsell('Повторы доступны в PRO.');
          break;
      }
    } catch (e) {
      if (mounted) setState(() => _hint = 'Микрофон недоступен: $e');
    } finally {
      if (mounted) setState(() => _listening = false);
    }
  }

  void _showProUpsell(String message) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (_) => ProSheet(controller: widget.controller, note: message),
    );
  }

  Future<void> _submit() async {
    final text = _textCtrl.text.trim();
    final when = _when;
    if (when == null) {
      setState(() => _hint = 'Выберите дату и время.');
      return;
    }
    final res = await widget.controller.create(text: text, when: when);
    if (!mounted) return;
    switch (res.outcome) {
      case AddOutcome.created:
        Navigator.of(context).pop();
        break;
      case AddOutcome.limitReached:
        _showProUpsell('В бесплатной версии можно не больше 3 напоминаний.');
        break;
      case AddOutcome.repeatBlocked:
        _showProUpsell('Повторы доступны в PRO.');
        break;
      case AddOutcome.needTime:
        setState(() => _hint = 'Не удалось определить время.');
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          16, 8, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Новое напоминание',
              style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: _textCtrl,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Что напомнить',
              hintText: 'Например: полить цветы',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickDateTime,
                  icon: const Icon(Icons.event),
                  label: Text(_when == null
                      ? 'Дата и время'
                      : MaterialLocalizations.of(context)
                          .formatFullDate(_when!)),
                ),
              ),
              const SizedBox(width: 12),
              FilledButton.tonalIcon(
                onPressed: _listening ? null : _listen,
                icon: Icon(_listening ? Icons.graphic_eq : Icons.mic),
                label: Text(_listening ? 'Слушаю…' : 'Голосом'),
              ),
            ],
          ),
          if (_hint != null) ...[
            const SizedBox(height: 8),
            Text(_hint!,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(onPressed: _submit, child: const Text('Создать')),
        ],
      ),
    );
  }
}
