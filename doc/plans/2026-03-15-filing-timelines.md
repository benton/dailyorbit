# Per-Filing Timeline Design

**Milestone:** v0.3.5 — Enriched data model
**Status:** Complete

## Overview

Synthesize per-filing timelines dynamically from existing date fields and pleading records. Display as a two-lane Mosaic/vgplot visualization on the filing detail page.

## Design Decisions

- **Dynamic synthesis, future-proof shape:** Timeline events are computed on-the-fly from existing filing date columns and pleading records. No new tables or migrations. The API response shape (`TimelineEvent[]`) is designed to be drop-in compatible with a future explicit `filing_event` table.
- **Two swim lanes:** Milestones (filing lifecycle) on top, pleading activity on bottom, sharing a time axis. Keeps the two narratives visually distinct while showing temporal relationships.
- **Mosaic/vgplot:** Natural fit for temporal data visualization. Cosmograph's graph layout would fight against the linear time axis.

## Data Model

### New Types

```typescript
type TimelineEventSource = 'filing_field' | 'pleading';

type TimelineEventType =
  // Filing milestones
  | 'filed' | 'signed' | 'public_notice' | 'action_notice'
  | 'granted' | 'denied' | 'dismissed' | 'surrendered'
  | 'blocked' | 'effective' | 'expired' | 'last_action'
  // Pleading types
  | 'comment' | 'petition' | 'supplement' | 'decision'
  | 'letter' | 'other';

interface TimelineEvent {
  date: string;           // ISO date
  type: TimelineEventType;
  label: string;          // e.g. "Application Filed" or "PETITION by Loral Space"
  actor?: string;         // Party name for pleadings, null for milestones
  source: TimelineEventSource;
}
```

### Synthesis Function

Pure function `synthesizeTimeline(filing, pleadings): TimelineEvent[]`:
1. Map each non-null filing date field to a `TimelineEvent` with `source: 'filing_field'`
2. Map each pleading to a `TimelineEvent` with `source: 'pleading'`, using the party name as `actor`
3. Sort by date ascending
4. Return the array

### API Response

The existing `FilingDetail` response gains a `timeline: TimelineEvent[]` field.

## Visualization

### Component: `FilingTimeline.tsx`

- **Location:** Main content column, between Description and Attachments
- **Height:** ~160-200px
- **Library:** Mosaic/vgplot from `@cosmograph/react`

### Visual Encoding

| Lane | Events | Color | Size |
|------|--------|-------|------|
| Top: Milestones | Filing lifecycle dates | Amber/gold | Uniform |
| Bottom: Pleadings | Comments, petitions, etc. | Badge colors (red=PETITION, green=SUPPLEMENT, orange=DECISION, etc.) | Uniform |

- Dots on the same date are jittered vertically within their lane
- Hover tooltip shows full event details (type, label, actor, date)
- No click-through or brushing for v0.3.5

### Edge Cases

- No pleadings: single milestone lane only
- Few dates: renders sparse but still useful
- Long timespans: vgplot auto-scales the time axis

## Implementation Steps

1. Add `TimelineEvent` types to `packages/server/src/filings/types.ts`
2. Create `packages/server/src/filings/timeline.ts` with `synthesizeTimeline()` pure function
3. Unit test with SAT-LOA-19991207-00117 data (14 date fields, 14 pleadings spanning 1999-2004)
4. Wire into filing detail API route, add `timeline` to response
5. Create `packages/web/src/filings/FilingTimeline.tsx` with Mosaic/vgplot two-lane visualization
6. Integrate into `FilingDetail.tsx` between Description and Attachments
7. Iterate with real data from filings with varying lifespans and activity levels

## Future Extensions

- **Explicit event table:** When `filing_event` is introduced, merge both sources into the same `TimelineEvent[]` — frontend unchanged
- **Cross-filing context:** Show related filing milestones (same applicant, competing applications) as a third lane
- **Mosaic cross-filtering:** Brush a date range on the timeline to filter the comments table below
