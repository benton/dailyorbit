/**
 * Business-day date helpers for "yesterday" semantics across the newspaper
 * and dashboard. All dates are strings in `YYYY-MM-DD` form.
 *
 * "Last business day before X" means: walk backward from X by one calendar
 * day, and if that lands on a weekend, keep walking back to the preceding
 * Friday. No holiday calendar — the FCC EFS system observes its own and we
 * let empty result sets speak for themselves on those days.
 */

/** Parse a `YYYY-MM-DD` string into a UTC Date at noon (timezone-safe). */
function parseIsoDate(isoDate: string): Date {
  return new Date(isoDate + 'T12:00:00Z');
}

/** Format a Date as `YYYY-MM-DD` in UTC. */
function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Return the most recent business day strictly before `editionDate`.
 *   Tue → Mon, Mon → Fri, Sun → Fri, Sat → Fri.
 */
export function lastBusinessDayBefore(editionDate: string): string {
  const d: Date = parseIsoDate(editionDate);
  d.setUTCDate(d.getUTCDate() - 1);
  const dow: number = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0) {
    d.setUTCDate(d.getUTCDate() - 2); // Sun → Fri
  } else if (dow === 6) {
    d.setUTCDate(d.getUTCDate() - 1); // Sat → Fri
  }
  return formatIsoDate(d);
}

/**
 * Return the human weekday name (e.g. "Monday") for a `YYYY-MM-DD` date.
 */
export function weekdayLabel(isoDate: string): string {
  return parseIsoDate(isoDate).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
