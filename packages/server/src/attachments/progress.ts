/**
 * Log periodic progress updates.
 *
 * Emits a log line every `interval` items (and on completion).
 * No terminal escape codes — suitable for structured log output.
 */
export function logProgress(
  completed: number,
  total: number,
  label: string,
  log: (msg: string) => void,
  interval: number = 500,
): void {
  if (completed < total && completed % interval !== 0) {
    return;
  }
  const pct: number = total > 0 ? Math.round((completed / total) * 100) : 100;
  log(`${label}: ${String(completed)}/${String(total)} (${String(pct)}%)`);
}
