import { describe, expect, it } from 'vitest';
import { resolveRecentFilingsTarget } from './routes.ts';

/**
 * Pure-logic tests for the `/api/stats/recent-filings` date-resolution
 * helper. The HTTP route itself is a thin wrapper that hands the resolved
 * targetDate to getRecentFilings(); those query semantics are already
 * covered by stats/repository.test.ts and business-day.test.ts.
 */

describe('resolveRecentFilingsTarget — with ?before=', () => {
  it('returns the previous business day for a mid-week edition date', () => {
    // Tuesday 2026-04-07 → Monday 2026-04-06
    expect(resolveRecentFilingsTarget('2026-04-07')).toEqual({
      ok: true,
      targetDate: '2026-04-06',
      dayLabel: 'Monday',
    });
  });

  it('skips the weekend for a Monday edition', () => {
    // Monday 2026-04-06 → Friday 2026-04-03
    expect(resolveRecentFilingsTarget('2026-04-06')).toEqual({
      ok: true,
      targetDate: '2026-04-03',
      dayLabel: 'Friday',
    });
  });

  it('returns Friday for a Saturday weekend edition', () => {
    // Saturday 2026-04-04 → Friday 2026-04-03
    expect(resolveRecentFilingsTarget('2026-04-04')).toEqual({
      ok: true,
      targetDate: '2026-04-03',
      dayLabel: 'Friday',
    });
  });

  it('returns Friday for a Sunday weekend edition', () => {
    // Sunday 2026-04-05 → Friday 2026-04-03
    expect(resolveRecentFilingsTarget('2026-04-05')).toEqual({
      ok: true,
      targetDate: '2026-04-03',
      dayLabel: 'Friday',
    });
  });

  it('returns Thursday for a Friday edition — the reported bug', () => {
    // Friday 2026-04-03 → Thursday 2026-04-02
    // This is the scenario the user reported: the Yesterday's Filings
    // table on the 2026-04-03 edition must show Thursday, not Monday.
    expect(resolveRecentFilingsTarget('2026-04-03')).toEqual({
      ok: true,
      targetDate: '2026-04-02',
      dayLabel: 'Thursday',
    });
  });

  it('handles month boundaries', () => {
    // Wednesday 2026-04-01 → Tuesday 2026-03-31
    expect(resolveRecentFilingsTarget('2026-04-01')).toEqual({
      ok: true,
      targetDate: '2026-03-31',
      dayLabel: 'Tuesday',
    });
  });

  it('rejects malformed date strings with an error', () => {
    expect(resolveRecentFilingsTarget('not-a-date')).toEqual({
      ok: false,
      error: 'Invalid before date format, expected YYYY-MM-DD',
    });
  });

  it('rejects partial date strings', () => {
    expect(resolveRecentFilingsTarget('2026-04')).toEqual({
      ok: false,
      error: 'Invalid before date format, expected YYYY-MM-DD',
    });
  });
});

describe('resolveRecentFilingsTarget — with no before param', () => {
  it('falls back to the current wall-clock last business day', () => {
    // Preserves the homepage/dashboard semantics: no param → today-relative.
    // We can't assert the specific date without freezing time, so we just
    // verify the shape of the response: a valid YYYY-MM-DD string and a
    // non-empty weekday label.
    const result = resolveRecentFilingsTarget(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.dayLabel.length).toBeGreaterThan(0);
    }
  });

  it('treats an empty string the same as undefined', () => {
    const result = resolveRecentFilingsTarget('');
    expect(result.ok).toBe(true);
  });
});
