import { parseGroup, dropDateWords, spokenDateKind } from "./groups.js";
import { toDigits } from "./phrase-digits.js";
import { spokenDate, stripDate } from "./dates-spoken.js";

// The editor shows the complete phrase; the stored reminder keeps only its subject.
//
// Дату и время показываем цифрами: «завтра в семь утра» читается медленнее,
// чем «18.11 в 07:00», и в цифрах легче заметить ошибку распознавания.
// Исходная расшифровка при этом сохраняется в originalTranscript и не теряется.
export function editorPhrase(draft, now = new Date()) {
  const source =
    typeof draft.phrase === "string"
      ? draft.phrase
      : draft.originalTranscript || "";
  if (source) return toDigits(source, draft, now);
  return [
    draft.text || "",
    ...(draft.times || draft.schedule?.times || []).map((t) => `в ${t}`),
  ]
    .join(" ")
    .trim();
}
/**
 * Разбирает фразу из поля ввода.
 *
 * options.dates — понимать ли даты, сказанные словами. Сейчас это доступно
 * всем: «завтра», «в пятницу», «двадцать пятого декабря» разбираются и
 * голосом, и при наборе. Флаг остался для совместимости: выключить разбор
 * можно явно ({ dates: false }), и тогда слова даты не станут текстом
 * напоминания — их снимет dropDateWords.
 */
export function parseEditor(phrase, current, now = new Date(), options = {}) {
  const dateSpeech = options.dates !== false;
  const parsed = parseGroup(
    phrase,
    current.selectedDates || [],
    now,
    { dates: dateSpeech },
  );

  // Распознавание дат из речи — платная возможность. Когда она недоступна,
  // слова даты из фразы не разбираем, но и в текст напоминания не пускаем:
  // иначе получилось бы «Завтра полить цветы» вместо «Полить цветы».
  if (!dateSpeech) {
    const clean = dropDateWords(phrase);
    const rest = parseGroup(clean || "", [], now, { dates: false });
    return {
      ...current,
      ...rest,
      phrase: clean,
      text: rest.text,
      dates: current.selectedDates || [],
      selectedDates: current.selectedDates || [],
      dateConflict: null,
      schedule: {
        ...rest.schedule,
        kind: "dates",
        dates: current.selectedDates || [],
        times: rest.times || [],
      },
      // Запоминаем, какое слово даты человек произнёс. Дату из него не
      // берём — день выбирается на календаре, — но при сохранении скажем,
      // что записали на сегодня. Иначе «завтра полить цветы» молча встало
      // бы на сегодня, а человек ждал бы завтра.
      spokenDateWord: spokenDateKind(phrase),
      id: current.id,
      color: current.color,
    };
  }

  // Дату, произнесённую словами («двадцать пятого декабря», «первого
  // сентября»), parseGroup не понимает — она уходила в текст, и
  // напоминание срабатывало сегодня. Разбираем её отдельно и, если
  // нашли, подставляем вместо сегодняшней даты.
  const spoken = spokenDate(phrase, now);
  if (spoken) {
    const alreadySame =
      parsed.dates && parsed.dates.length === 1 && parsed.dates[0] === spoken.date;
    if (!alreadySame) {
      const rest = stripDate(phrase, spoken.match).trim();
      const withoutDate = parseGroup(rest || phrase, [], now, { dates: dateSpeech });
      return {
        ...current,
        ...withoutDate,
        phrase: rest || withoutDate.text || parsed.text,
        text: withoutDate.text || parsed.text,
        dateConflict: null,
        selectedDates: [spoken.date],
        dates: [spoken.date],
        schedule: {
          ...withoutDate.schedule,
          kind: "dates",
          dates: [spoken.date],
          times:
            (withoutDate.times && withoutDate.times.length
              ? withoutDate.times
              : parsed.times) || [],
        },
        id: current.id,
        color: current.color,
      };
    }
  }

  return {
    ...current,
    ...parsed,
    phrase,
    id: current.id,
    color: current.color,
  };
}
/**
 * Отмечает или снимает дату на календаре.
 *
 * options.maxDates — предел дат на одно событие. Сейчас ограничения нет:
 * несколько дат доступны всем, поэтому параметр не передаётся. Оставлен на
 * случай, если предел понадобится вернуть. Снять уже выбранную дату можно
 * всегда, иначе человек не смог бы передумать.
 *
 * Возвращает { draft, blocked }: blocked сообщает, что попытка отклонена, и
 * вызывающий код показывает пояснение. Возвращать ошибку исключением здесь
 * неудобно: выбор даты — обычное действие, и оно не должно ломать экран.
 */
export function toggleEditorDate(current, date, options = {}) {
  const maxDates = Number.isFinite(options.maxDates) ? options.maxDates : null;
  const selected = current.selectedDates ?? current.dates ?? [];
  const removing = selected.includes(date);
  if (!removing && maxDates !== null && selected.length >= maxDates)
    return { draft: current, blocked: true };
  const dates = removing
    ? selected.filter((d) => d !== date)
    : [...selected, date].sort();
  return {
    blocked: false,
    draft: {
      ...current,
      selectedDates: dates,
      dates,
      dateConflict: null,
      schedule: {
        ...current.schedule,
        kind: "dates",
        dates,
        times: current.times || [],
      },
    },
  };
}
// Late OS callbacks from a cleared/aborted session must never resurrect its text.
export function sessionGate() {
  let generation = 0;
  return { next: () => ++generation, valid: (token) => token === generation };
}
