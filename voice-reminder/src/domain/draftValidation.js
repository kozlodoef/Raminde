export function unresolvedDraftIssues(issues) {
  return [
    ...new Set(
      (Array.isArray(issues) ? issues : [issues])
        .map((issue) => String(issue || "").trim())
        .filter(Boolean),
    ),
  ];
}

export function unresolvedDraftMessage(issues) {
  const pending = unresolvedDraftIssues(issues);
  return pending.length ? `Исправьте: ${pending.join(". ")}` : "";
}

function isInvalidDateIssue(issue) {
  return /(?:несуществующ(?:ая|ую) дата|такой даты не существует)/iu.test(issue);
}

export function issuesAfterDraftChange(issues, patch = {}) {
  const pending = unresolvedDraftIssues(issues);
  const invalidDate = pending.filter(isInvalidDateIssue);
  if (
    Object.prototype.hasOwnProperty.call(patch, "specificDates") ||
    Object.prototype.hasOwnProperty.call(patch, "at") ||
    Object.prototype.hasOwnProperty.call(patch, "anchorDate")
  )
    return pending.filter((issue) => !isInvalidDateIssue(issue));
  return invalidDate;
}
