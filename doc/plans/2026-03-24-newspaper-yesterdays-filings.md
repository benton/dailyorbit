# Newspaper Section: Yesterday's Filings

## Overview

Add a "Yesterday's Filings" section to the newspaper view, restyled as a vintage broadsheet filing ledger. This section reuses the existing data pipeline from the home page's "Yesterday's Filings" table but presents it in the newspaper's period aesthetic.

---

## Data Source

### Existing API
- **Endpoint:** `GET /api/stats/recent-filings`
- **Route handler:** `packages/server/src/stats/routes.ts` (lines 117–129)
- **Repository:** `packages/server/src/stats/repository.ts` — `getRecentFilings(conn, targetDate)`
- **Business day logic:** `lastBusinessDate()` returns yesterday on weekdays, Friday on Saturday/Sunday/Monday

### Response Shape
```typescript
type RecentFilingsResponse = {
  date: string;              // YYYY-MM-DD
  dayLabel: string;          // e.g., "Friday"
  filings: Array<RecentFiling>;
};

type RecentFiling = {
  file_number: string;
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
  summary: string | null;
};
```

### Key Fields to Display
- **File Number** — monospace, the primary identifier
- **Subsystem** — SAT, SES, SCL, etc. (3-letter code)
- **App Type** — LOA, MOD, STA, AMD, etc.
- **Applicant** — `address_attention` field
- **Company** — attributed company name (may be null)
- **Status** — filing status code

---

## Frontend Design

### Component
- **File:** `packages/web/src/newspaper/sections/YesterdaysFilings.tsx`
- **Grid area:** New grid area in the newspaper layout (see Layout below)

### Visual Style
A ledger-style table evoking a 1930s clerk's filing record:
- Section header image: `headers/yesterdays-filings.webp` (to be generated)
- Heading: `"{dayLabel}'s Filings"` (dynamic — "Friday's Filings", "Yesterday's Filings", etc.)
- Table rendered with `var(--np-font-mono)` (IBM Plex Mono) for file numbers
- Column headers in small-caps `var(--np-font-body)`
- Alternating row tinting using `var(--np-aged-white)` / `var(--np-parchment-light)`
- Thin sepia column rules (`1px solid var(--np-sepia-medium)`)
- Compact row height — this is a dense data table
- File numbers styled as links (blue, `var(--np-accent-blue)`)
- Null company names shown as em-dash `—`

### Data Fetching
- Fetch `GET /api/stats/recent-filings` in `NewspaperView.tsx` alongside the edition fetch
- Pass the filings array and dayLabel as props to the section component
- No new API endpoint needed

---

## Layout Integration

### Option A: Replace the fake ad column (row 1)
The fake ad is narrow and low-value. Yesterday's Filings could replace it in the left column, spanning both rows for a tall ledger effect.

### Option B: Add a third row
Add a full-width row beneath the current grid:
```
"filings filings filings filings"
```
This keeps all existing content and gives the filings table room to breathe.

### Recommendation: Option B
A full-width third row is more flexible and doesn't sacrifice the fake ad (which adds character). The filings table benefits from horizontal space for its columns.

---

## Grid CSS Changes

```css
.newspaper-grid {
  grid-template-columns: minmax(160px, 1fr) 1.5fr 1.5fr minmax(180px, 1.2fr);
  grid-template-rows: auto auto auto;
  grid-template-areas:
    "fakead  lead    lead    orbital"
    "company editorial editorial classifieds"
    "filings filings filings filings";
}

.grid-filings { grid-area: filings; }
```

---

## CSS Classes

```css
.filings-table { ... }           /* outer table wrapper */
.filings-table th { ... }        /* small-caps column headers */
.filings-table td { ... }        /* compact data cells */
.filings-table .file-number { }  /* monospace file number link */
.filings-table tr:nth-child(even) { } /* alternating row color */
```

---

## Files to Create
1. `packages/web/src/newspaper/sections/YesterdaysFilings.tsx`

## Files to Modify
1. `packages/web/src/newspaper/NewspaperView.tsx` — add data fetch, render section
2. `packages/web/src/newspaper/newspaper.css` — add grid area, table styles
3. `packages/web/src/newspaper/types.ts` — add `RecentFiling` and `RecentFilingsResponse` types

## No Server Changes Required
The existing `GET /api/stats/recent-filings` endpoint provides everything needed.
