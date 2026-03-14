/**
 * Parse a human-readable duration string into milliseconds.
 * Supported units: d (days), h (hours), m (minutes), s (seconds).
 * Examples: "7d", "24h", "30m", "90s", "2d12h"
 */
export function parseDuration(input: string): number {
  const pattern: RegExp = /(\d+)\s*([dhms])/g;
  let totalMs: number = 0;
  let matched: boolean = false;

  const multipliers: Record<string, number> = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };

  let match: RegExpExecArray | null = pattern.exec(input);
  while (match !== null) {
    matched = true;
    const value: number = Number(match[1]);
    const unit: string = match[2]!;
    totalMs += value * multipliers[unit]!;
    match = pattern.exec(input);
  }

  if (!matched) {
    throw new Error(
      `Invalid duration "${input}". Use units: d (days), h (hours), m (minutes), s (seconds). Example: "7d", "24h"`,
    );
  }

  return totalMs;
}
