import { parseGroup } from "./groups.js";
import { toDigits } from "./phrase-digits.js";

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
export function parseEditor(phrase, current, now = new Date()) {
  const parsed = parseGroup(phrase, current.selectedDates || [], now);
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
