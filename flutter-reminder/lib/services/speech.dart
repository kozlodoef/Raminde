// lib/services/speech.dart — голосовой ввод через Vosk (on-device).
//
// Этап 5 плана. Замена @capacitor-community/speech-recognition из JS-версии:
// тот плагин опирался на Google Speech Services и ломался/не работал на
// Huawei/Honor без GMS — критично для аудитории RuStore. Vosk распознаёт
// речь локально (модель ~40 МБ лежит в assets/models), интернет не нужен,
// приватность — аудиоданные не покидают телефон (плюс к политике ПДн 152-ФЗ).
//
// Поток: запись 16 кГц mono -> Vosk recognizer (rus model) -> текст фразы ->
// domain/time_parser.parseReminder.

import 'dart:async';
import 'dart:io';

import 'package:vosk_flutter/vosk_flutter.dart' as vosk;

class SpeechService {
  static const _modelAsset = 'assets/models/vosk-model-small-ru-0.22';

  vosk.Model? _model;
  vosk.Recognizer? _recognizer;
  StreamSubscription? _audioSub;

  bool get isReady => _recognizer != null;

  /// Распаковать модель из assets и инициализировать Vosk.
  /// Вызывать один раз при старте приложения (тяжелая операция, ~секунды).
  Future<void> init() async {
    if (_model != null) return;
    final dir = Directory.systemTemp.createTempSync('vosk');
    await _copyAssetDir(_modelAsset, dir);
    _model = vosk.Model('${dir.path}/${_modelAsset.split('/').last}');
    _recognizer = vosk.Recognizer(model: _model!);
  }

  Future<void> _copyAssetDir(String assetPrefix, Directory dest) async {
    // Реализация через rootBundle будет в контроллере (там есть контекст);
    // здесь — файловый fallback для уже распакованной модели.
    final src = Directory(assetPrefix);
    if (!src.existsSync()) return;
    for (final e in src.listSync(recursive: true)) {
      if (e is File) {
        final rel = e.path.substring(assetPrefix.length + 1);
        final f = File('${dest.path}/$rel');
        f.parent.createSync(recursive: true);
        await e.copy(f.path);
      }
    }
  }

  /// Записать короткую фразу и вернуть распознанный текст (или null).
  /// maxSeconds — защита от «забыли выключить микрофон».
  Future<String?> listenOnce({int maxSeconds = 10}) async {
    final rec = _recognizer;
    if (rec == null) throw StateError('SpeechService.init() не вызван');
    rec.reset();

    final completer = Completer<String?>();
    final buffer = StringBuffer();

    _audioSub = vosk.AudioRecorder().startStream().listen((chunk) {
      if (chunk is List<int>) {
        final ok = rec.acceptWaveForm(chunk);
        if (ok) {
          final text = rec.result(chunk);
          if (text.isNotEmpty) buffer.write('$text ');
        }
      }
    }, onError: (Object e) {
      if (!completer.isCompleted) completer.completeError(e);
    });

    // Стоп по таймауту или когда распознающий вернул финальный результат.
    Timer(Duration(seconds: maxSeconds), () async {
      await stop();
      final txt = buffer.toString().trim();
      if (!completer.isCompleted) {
        completer.complete(txt.isEmpty ? null : txt);
      }
    });

    return completer.future;
  }

  Future<void> stop() async {
    await _audioSub?.cancel();
    _audioSub = null;
    try {
      vosk.AudioRecorder().stop();
    } catch (_) {}
  }

  void dispose() {
    stop();
    _recognizer?.dispose();
    _recognizer = null;
    _model?.dispose();
    _model = null;
  }
}
