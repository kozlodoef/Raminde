import { parseGroup } from "./groups.js";

// The editor shows the complete phrase; the stored reminder keeps only its subject.
export function editorPhrase(draft) {
  if (typeof draft.phrase === "string") return draft.phrase;
  if (draft.originalTranscript) return draft.originalTranscript;
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
