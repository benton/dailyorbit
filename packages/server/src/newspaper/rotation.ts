import type { NewspaperContentType } from './types.ts';

// ── Types ────────────────────────────────────────────────────────

/** Day of week: 0=Sunday, 1=Monday ... 6=Saturday */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SlotSchedule = {
  contentType: NewspaperContentType;
  days: DayOfWeek[];
};

// ── Slot A: right sidebar (short, data-driven) ──────────────────

export const SLOT_A_SCHEDULE: ReadonlyArray<SlotSchedule> = [
  { contentType: 'orbital_forecast', days: [1] },
  { contentType: 'the_docket', days: [2, 5] },
  { contentType: 'spectrum_watch', days: [3] },
  { contentType: 'competitive_intel', days: [4] },
];

// ── Slot B: wide left with portrait/illustration ────────────────

export const SLOT_B_SCHEDULE: ReadonlyArray<SlotSchedule> = [
  { contentType: 'company_spotlight', days: [1] },
  { contentType: 'filing_in_focus', days: [2] },
  { contentType: 'the_applicant', days: [3] },
  { contentType: 'tech_spotlight', days: [4] },
  { contentType: 'from_the_archives', days: [5] },
];

// ── Slot C: right editorial (longer form) ───────────────────────

export const SLOT_C_SCHEDULE: ReadonlyArray<SlotSchedule> = [
  { contentType: 'editorial', days: [1] },
  { contentType: 'counsels_brief', days: [2] },
  { contentType: 'letters_to_editor', days: [3] },
  { contentType: 'market_signals', days: [4] },
  { contentType: 'press_gallery', days: [5] },
];

export const ALL_SLOT_SCHEDULES: ReadonlyArray<SlotSchedule> = [
  ...SLOT_A_SCHEDULE,
  ...SLOT_B_SCHEDULE,
  ...SLOT_C_SCHEDULE,
];

// ── Lookup ──────────────────────────────────────────────────────

export type DaySlots = {
  slotA: NewspaperContentType | null;
  slotB: NewspaperContentType | null;
  slotC: NewspaperContentType | null;
};

function findForDay(
  schedule: ReadonlyArray<SlotSchedule>,
  day: DayOfWeek,
): NewspaperContentType | null {
  const entry: SlotSchedule | undefined = schedule.find((s: SlotSchedule) =>
    s.days.includes(day),
  );
  return entry?.contentType ?? null;
}

/**
 * Returns the content types for each slot on a given day of the week.
 * Weekends (0=Sunday, 6=Saturday) return null for all slots.
 */
export function getContentTypesForDay(dayOfWeek: DayOfWeek): DaySlots {
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { slotA: null, slotB: null, slotC: null };
  }
  return {
    slotA: findForDay(SLOT_A_SCHEDULE, dayOfWeek),
    slotB: findForDay(SLOT_B_SCHEDULE, dayOfWeek),
    slotC: findForDay(SLOT_C_SCHEDULE, dayOfWeek),
  };
}
