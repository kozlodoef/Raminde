// lib/domain/access.dart — freemium-модель доступа.
//
// Прямной порт src/domain/access.js из React-версии: лимиты и правила
// должны совпадать один-в-один, чтобы пользователи обеих версий видели
// одинаковые условия. Бесплатная версия работает вечно, но с ограничениями;
// PRO снимает лимиты. Trial убран по решению от 02.11.2026: блокировка
// после 30 дней ухудшает удержание.

/// Максимум активных (невыполненных) напоминаний в бесплатной версии.
const int freeReminderLimit = 3;

/// Максимум повторов у одного напоминания в бесплатной версии.
const int freeRepeatLimit = 1;

class AccessStatus {
  /// До какой даты действует оплаченная подписка PRO (мс epoch). 0 — не было.
  final int paidUntil;

  const AccessStatus({this.paidUntil = 0});

  bool get isPro => paidUntil > DateTime.now().millisecondsSinceEpoch;

  Map<String, dynamic> toJson() => {'paidUntil': paidUntil};

  factory AccessStatus.fromJson(Map<String, dynamic> json) =>
      AccessStatus(paidUntil: (json['paidUntil'] as num?)?.toInt() ?? 0);
}

/// Можно ли создать ещё одно напоминание при текущем их количестве [count].
bool canCreateReminder(int count, bool isPro) =>
    isPro || count < freeReminderLimit;

/// Разрешено ли повторное напоминание ([repeats] > [freeRepeatLimit]) только с PRO.
bool canRepeat(bool isPro, int repeats) => isPro || repeats <= freeRepeatLimit;
