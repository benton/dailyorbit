import { describe, expect, it } from 'vitest';
import { lastBusinessDayBefore, weekdayLabel } from './business-day.ts';

describe('lastBusinessDayBefore', () => {
  it('returns previous day for a mid-week edition', () => {
    // Tuesday 2026-04-07 → Monday 2026-04-06
    expect(lastBusinessDayBefore('2026-04-07')).toBe('2026-04-06');
  });

  it('skips the weekend for a Monday edition', () => {
    // Monday 2026-04-06 → Friday 2026-04-03
    expect(lastBusinessDayBefore('2026-04-06')).toBe('2026-04-03');
  });

  it('returns Friday for a Saturday edition', () => {
    // Saturday 2026-04-04 → Friday 2026-04-03
    expect(lastBusinessDayBefore('2026-04-04')).toBe('2026-04-03');
  });

  it('returns Friday for a Sunday edition', () => {
    // Sunday 2026-04-05 → Friday 2026-04-03
    expect(lastBusinessDayBefore('2026-04-05')).toBe('2026-04-03');
  });

  it('handles month boundaries', () => {
    // Wednesday 2026-04-01 → Tuesday 2026-03-31
    expect(lastBusinessDayBefore('2026-04-01')).toBe('2026-03-31');
  });
});

describe('weekdayLabel', () => {
  it('returns full weekday names', () => {
    expect(weekdayLabel('2026-04-06')).toBe('Monday');
    expect(weekdayLabel('2026-04-07')).toBe('Tuesday');
    expect(weekdayLabel('2026-04-03')).toBe('Friday');
  });
});
