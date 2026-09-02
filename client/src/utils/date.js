/**
 * Formats ISO date string or Date object into human-readable date.
 * Example: "2 Sep 2026, 11:34 AM"
 */
export function formatDate(dateInput) {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(d);
  } catch (e) {
    return "—";
  }
}

/**
 * Formats duration in milliseconds to human readable string (e.g. "124ms", "2.4s")
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
