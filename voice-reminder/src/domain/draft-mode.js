// Editing continues after the microphone stops, until the draft is saved or cleared.
export function isComposingReminder({
  draft = {},
  queue = [],
  voice = "idle",
  live = "",
  started = false,
} = {}) {
  return (
    started ||
    voice !== "idle" ||
    queue.length > 0 ||
    Boolean(live.trim()) ||
    Boolean(
      draft.text?.trim() ||
      draft.originalTranscript?.trim() ||
      draft.dates?.length ||
      draft.times?.length,
    )
  );
}
