import { describe, expect, test } from 'vitest';
import {
  getContentTypesForDay,
  SLOT_A_SCHEDULE,
  SLOT_B_SCHEDULE,
  SLOT_C_SCHEDULE,
  type DayOfWeek,
} from './rotation.ts';

describe('getContentTypesForDay', () => {
  const EXPECTED_GRID: Array<{
    day: DayOfWeek;
    label: string;
    slotA: string | null;
    slotB: string | null;
    slotC: string | null;
  }> = [
    {
      day: 1,
      label: 'Monday',
      slotA: 'orbital_forecast',
      slotB: 'company_spotlight',
      slotC: 'editorial',
    },
    {
      day: 2,
      label: 'Tuesday',
      slotA: 'the_docket',
      slotB: 'filing_in_focus',
      slotC: 'counsels_brief',
    },
    {
      day: 3,
      label: 'Wednesday',
      slotA: 'spectrum_watch',
      slotB: 'the_applicant',
      slotC: 'letters_to_editor',
    },
    {
      day: 4,
      label: 'Thursday',
      slotA: 'competitive_intel',
      slotB: 'tech_spotlight',
      slotC: 'market_signals',
    },
    {
      day: 5,
      label: 'Friday',
      slotA: 'the_docket',
      slotB: 'from_the_archives',
      slotC: 'press_gallery',
    },
  ];

  test.each(EXPECTED_GRID)(
    '$label returns correct slot types',
    ({ day, slotA, slotB, slotC }) => {
      expect(getContentTypesForDay(day)).toEqual({ slotA, slotB, slotC });
    },
  );

  test.each([
    { day: 0 as DayOfWeek, label: 'Sunday' },
    { day: 6 as DayOfWeek, label: 'Saturday' },
  ])('$label returns week_in_review for slotA, null for B/C', ({ day }) => {
    expect(getContentTypesForDay(day)).toEqual({
      slotA: 'week_in_review',
      slotB: null,
      slotC: null,
    });
  });
});

describe('schedule completeness', () => {
  const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];

  test('every weekday has exactly one Slot A entry', () => {
    for (const day of WEEKDAYS) {
      const matches: number = SLOT_A_SCHEDULE.filter((s) =>
        s.days.includes(day),
      ).length;
      expect(matches).toEqual(1);
    }
  });

  test('every weekday has exactly one Slot B entry', () => {
    for (const day of WEEKDAYS) {
      const matches: number = SLOT_B_SCHEDULE.filter((s) =>
        s.days.includes(day),
      ).length;
      expect(matches).toEqual(1);
    }
  });

  test('every weekday has exactly one Slot C entry', () => {
    for (const day of WEEKDAYS) {
      const matches: number = SLOT_C_SCHEDULE.filter((s) =>
        s.days.includes(day),
      ).length;
      expect(matches).toEqual(1);
    }
  });
});
