import type {
  FilingPetition,
  TimelineEvent,
  TimelineEventType,
} from './types.ts';

/** The filing date fields used for timeline synthesis. */
type FilingDateFields = {
  dateFiled: string | null;
  dateSigned: string | null;
  dateGrant: string | null;
  dateBegin: string | null;
  dateExpire: string | null;
  lastActionDate: string | null;
};

/** Maps filing date field names to their timeline event type and label. */
const FILING_DATE_FIELDS: Array<{
  field: keyof FilingDateFields;
  type: TimelineEventType;
  label: string;
}> = [
  { field: 'dateFiled', type: 'filed', label: 'Application Filed' },
  { field: 'dateSigned', type: 'signed', label: 'Application Signed' },
  { field: 'dateGrant', type: 'granted', label: 'Granted' },
  { field: 'dateBegin', type: 'effective', label: 'Effective Date' },
  { field: 'dateExpire', type: 'expired', label: 'Expiration Date' },
  { field: 'lastActionDate', type: 'last_action', label: 'Last Action' },
];

/** Maps pleading type strings to TimelineEventType. */
function pleadingTypeToEventType(pleadingType: string | null): TimelineEventType {
  switch (pleadingType?.toUpperCase()) {
    case 'PETITION':
      return 'petition';
    case 'SUPPLEMENT':
      return 'supplement';
    case 'DECISION':
      return 'decision';
    case 'LETTER':
      return 'letter';
    case 'COMMENT':
      return 'comment';
    default:
      return 'other';
  }
}

/** Build a human-readable label for a pleading event. */
function pleadingLabel(petition: FilingPetition): string {
  const typeStr: string = petition.pleadingType ?? 'Other';
  const actor: string = petition.partyName ?? 'Unknown';
  return `${typeStr} by ${actor}`;
}

/**
 * Synthesize a timeline from a filing's date fields and its pleadings.
 * Returns events sorted by date ascending.
 *
 * This is a pure function — no DB or side effects.
 */
export function synthesizeTimeline(
  filing: FilingDateFields,
  petitions: FilingPetition[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 1. Map each non-null filing date field to a milestone event
  for (const { field, type, label } of FILING_DATE_FIELDS) {
    const dateValue: string | null = filing[field] as string | null;
    if (dateValue != null) {
      events.push({
        date: normalizeDate(dateValue),
        type,
        label,
        actor: null,
        source: 'filing_field',
      });
    }
  }

  // 2. Map each pleading to a pleading event
  for (const petition of petitions) {
    if (petition.dateFiled == null) continue;
    events.push({
      date: normalizeDate(petition.dateFiled),
      type: pleadingTypeToEventType(petition.pleadingType),
      label: pleadingLabel(petition),
      actor: petition.partyName ?? null,
      source: 'pleading',
    });
  }

  // 3. Sort by date ascending
  events.sort((a: TimelineEvent, b: TimelineEvent) => a.date.localeCompare(b.date));

  return events;
}

/** Normalize a date string to ISO date (YYYY-MM-DD), stripping any time component. */
function normalizeDate(dateStr: string): string {
  // Fast path: already YYYY-MM-DD (10 chars, starts with digit)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Fast path: ISO or timestamp with YYYY-MM-DD prefix
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(dateStr)) return dateStr.slice(0, 10);
  // Fallback: parse via Date for JS toString() format and others
  const d: Date = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}
