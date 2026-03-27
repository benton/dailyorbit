const BAR_WIDTH: number = 40;

/**
 * Render a progress bar to stderr. Uses \r to overwrite the current line.
 * Prints a newline when complete.
 *
 * When throttleInterval > 0, only renders every N items (plus the final one)
 * to avoid overwhelming the log output in large loops.
 */
export function printProgress(
  completed: number,
  total: number,
  label: string,
  throttleInterval: number = 0,
): void {
  // Throttle: skip intermediate updates unless at the interval or finished
  if (
    throttleInterval > 0 &&
    completed < total &&
    completed % throttleInterval !== 0
  ) {
    return;
  }

  const pct: number = total > 0 ? completed / total : 1;
  const filled: number = Math.round(BAR_WIDTH * pct);
  const empty: number = BAR_WIDTH - filled;
  const bar: string = '#'.repeat(filled) + '-'.repeat(empty);
  const elapsed: string = completed === total ? ' done' : '';
  const line: string = `\r  ${label} [${bar}] ${String(completed)}/${String(total)}${elapsed}`;
  process.stderr.write(line);
  if (completed === total) {
    process.stderr.write('\n');
  }
}
