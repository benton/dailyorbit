import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';

describe('parseDuration', () => {
  it('parses days', () => {
    expect(parseDuration('7d')).toEqual(7 * 86_400_000);
  });

  it('parses hours', () => {
    expect(parseDuration('24h')).toEqual(24 * 3_600_000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m')).toEqual(30 * 60_000);
  });

  it('parses seconds', () => {
    expect(parseDuration('90s')).toEqual(90_000);
  });

  it('parses compound durations', () => {
    expect(parseDuration('2d12h')).toEqual(2 * 86_400_000 + 12 * 3_600_000);
  });

  it('parses compound with spaces', () => {
    expect(parseDuration('1d 6h 30m')).toEqual(
      86_400_000 + 6 * 3_600_000 + 30 * 60_000,
    );
  });

  it('throws on invalid input', () => {
    expect(() => parseDuration('foo')).toThrow('Invalid duration');
  });

  it('throws on empty string', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration');
  });
});
