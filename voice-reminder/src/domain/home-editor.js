import { parseGroup, dropDateWords } from "./groups.js";
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
 * options.dates — понимать ли даты, сказанные словами. В бесплатной версии
 * это выключено: время и событие распознаются голосом, а даты человек
 * отмечает на календаре. Если не отметил — напоминание встаёт на сегодня.
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
export function toggleEditorDate(current, date) {
  const selected = current.selectedDates ?? current.dates ?? [];
  const dates = selected.includes(date)
    ? selected.filter((d) => d !== date)
    : [...selected, date].sort();
  return {
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
  };
}
// Late OS callbacks from a cleared/aborted session must never resurrect its text.
export function sessionGate() {
  let generation = 0;
  return { next: () => ++generation, valid: (token) => token === generation };
}
