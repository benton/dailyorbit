# UI Polish Batch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix ~11 UI issues across home page, filing detail, admin, and shared components.

**Architecture:** All changes are frontend or thin API additions. No schema changes. Tasks are independent unless noted.

**Tech Stack:** React, Tailwind CSS, TanStack Table, vgplot/Mosaic, Hono API, DuckDB

---

## Task 1: Fix Page Width Toggle (Wide = No Max Width)

**Context:** `PublicLayout` uses `max-w-[96rem]` for wide mode, but several child pages hard-code `max-w-5xl` or `max-w-7xl` in their root `<div>`, overriding the layout. Wide mode should remove the `max-w-*` entirely (keeping `p-6` for edge whitespace). Child pages should not set their own max-width — the layout owns it.

**Files:**
- Modify: `packages/web/src/ui/PublicLayout.tsx:61`
- Modify: `packages/web/src/admin/AdminLayout.tsx:79`
- Modify: `packages/web/src/home/HomePage.tsx:419`
- Modify: `packages/web/src/home/UserHomePage.tsx:49`
- Modify: `packages/web/src/search/SearchPage.tsx:1124`
- Modify: `packages/web/src/filings/FilingDetail.tsx:239`
- Modify: `packages/web/src/companies/CompanyDetail.tsx:291`
- Modify: `packages/web/src/companies/CompaniesPage.tsx:61`
- Modify: `packages/web/src/satellites/SatelliteDetail.tsx:172`
- Modify: `packages/web/src/earth-stations/EarthStationDetail.tsx` (find root div)

**Step 1: Update PublicLayout**

In `PublicLayout.tsx:61`, change:
```tsx
<main className={`mx-auto p-6 ${isWide ? 'max-w-[96rem]' : 'max-w-6xl'}`}>
```
to:
```tsx
<main className={`mx-auto p-6 ${isWide ? '' : 'max-w-6xl'}`}>
```

**Step 2: Update AdminLayout**

In `AdminLayout.tsx:79`, change:
```tsx
<main className={`mx-auto p-6 ${isWide ? 'max-w-[96rem]' : 'max-w-5xl'}`}>
```
to:
```tsx
<main className={`mx-auto p-6 ${isWide ? '' : 'max-w-5xl'}`}>
```

**Step 3: Remove per-page max-width constraints**

In every child page listed above, remove the `max-w-*` class from the root `<div>`. The layout's `<main>` already constrains width. For example:

- `HomePage.tsx:419`: `"mx-auto max-w-5xl space-y-6 p-6"` → `"space-y-6"`
- `UserHomePage.tsx:49`: same pattern
- `SearchPage.tsx:1124`: `"mx-auto max-w-7xl space-y-4 p-6"` → `"space-y-4"`
- `FilingDetail.tsx:239`: `"mx-auto max-w-7xl space-y-6 p-6"` → `"space-y-6"`
- `CompanyDetail.tsx:291`: same pattern
- `CompaniesPage.tsx:61`: same pattern
- `SatelliteDetail.tsx:172`: same pattern
- `EarthStationDetail.tsx`: same pattern

Remove `mx-auto`, `max-w-*`, and `p-6` from each — the layout provides these.

**Step 4: Verify in browser**

Run: `make dev`
- Toggle wide/narrow on home page, filing detail, search, admin
- Confirm edge padding is preserved in wide mode
- Confirm narrow mode still looks correct

**Step 5: Commit**
```
feat(ui): fix page width toggle to stretch fully in wide mode
```

---

## Task 2: Add SummaryTooltip to Home Page Recent Filings

**Context:** The home page "Yesterday's Filings" table shows a `SimpleDataTable<RecentFiling>` but the `RecentFiling` type doesn't include a `summary` field. The API endpoint `/api/stats/recent-filings` needs to join the attachment summary.

**Files:**
- Modify: `packages/server/src/stats/repository.ts` (the `getRecentFilings` function)
- Modify: `packages/server/src/stats/types.ts` (add `summary` to `RecentFiling` type if exists, or check inline type)
- Modify: `packages/web/src/home/HomePage.tsx` (add `summary` to `RecentFiling` type, wrap file_number column in `SummaryTooltip`)

**Step 1: Find and read `getRecentFilings`**

Locate the server-side function that serves `/api/stats/recent-filings` and understand its SQL.

**Step 2: Add summary to the query**

Join the attachment table to pull the best available summary for each filing. Use the same logic as `getFilingByFileNumber` — prefer 'Attachment Application' summary, fall back to any attachment with a summary:
```sql
(SELECT a.summary FROM attachment a
 WHERE a.filing_key = f.filing_key
 ORDER BY CASE WHEN a.attachment_name = 'Attachment Application' THEN 0 ELSE 1 END,
          a.attachment_key
 LIMIT 1) AS summary
```

**Step 3: Update the server-side type/mapping**

Add `summary: string | null` to the return type and map `row.summary`.

**Step 4: Update the frontend `RecentFiling` type**

In `HomePage.tsx`, add `summary: string | null` to the `RecentFiling` type.

**Step 5: Wrap file_number column in SummaryTooltip**

Update `recentFilingColumns` definition. The `file_number` column currently has no custom `cell` renderer — add one:
```tsx
{
  accessorKey: 'file_number',
  header: 'File Number',
  size: 220,
  cell: ({ row }) => (
    <SummaryTooltip summary={row.original.summary}>
      <span className="font-mono">{row.original.file_number}</span>
    </SummaryTooltip>
  ),
},
```

Import `SummaryTooltip` at the top of the file.

**Step 6: Test**

- Run `make dev`, navigate to home page
- Hover over a file number in Yesterday's Filings — tooltip should appear if summary exists

**Step 7: Commit**
```
feat(home): add attachment summary tooltip to recent filings table
```

---

## Task 3: Fix SummaryTooltip Left-Edge Clipping

**Context:** In `SummaryTooltip.tsx`, the tooltip is positioned at `left: rect.left + scrollX + rect.width/2` with `transform: translate(-50%, ...)`. Near the left viewport edge, the tooltip gets clipped. Fix: clamp left position so the tooltip stays within viewport bounds.

**Files:**
- Modify: `packages/web/src/ui/SummaryTooltip.tsx:30-35`

**Step 1: Add viewport clamping logic**

After computing `left`, clamp it so the tooltip (max-width 28rem = 448px, so half = 224px) stays on-screen:
```tsx
const tooltipHalfWidth = 224; // max-w-md / 2
const rawLeft = rect.left + window.scrollX + rect.width / 2;
const clampedLeft = Math.max(tooltipHalfWidth + 16, Math.min(rawLeft, window.innerWidth - tooltipHalfWidth - 16));
```

Use `clampedLeft` instead of the raw value in `setPosition`.

**Step 2: Verify**

- Navigate to filing detail page with attachments
- Hover over an attachment name near the left edge — tooltip should shift right
- Also check search results page near left edge

**Step 3: Commit**
```
fix(ui): prevent SummaryTooltip from clipping at viewport edges
```

---

## Task 4: Reify Filing Status + Prominent Status Display

**Context:** The filing detail header shows `<Badge variant="secondary">{filing.statusText}</Badge>` but the screenshot shows it's absent — likely because `statusText` is null for some filings. The actual filing data uses a mix of lookup-table codes (like `ATPN`, `A/C`) AND free-text statuses from ICFS (like `Closed`, `Current`, `Pending Review`). We need: (a) a `FilingStatus` classifier with colors/labels, (b) a more prominent display, and (c) a fallback for unknown codes.

**Actual status code distribution in the DB (top by frequency):**
```
Closed          105,597   ← ICFS free-text (terminal)
Current          14,603   ← ICFS free-text (active)
ATPN              6,643   ← Action Taken Public Notice
INP               6,228   ← Internet Not Processed
A/C               5,616   ← Action Complete
Pending Review    1,211   ← ICFS free-text
COR                  64   ← Administrative Correction
AFPN                 45   ← Accepted for Filing Public Notice
UNBLK                44   ← Unblocked
Pending Payment      37   ← ICFS free-text
Pending Consummation 25   ← ICFS free-text
```

There are 82 codes in the `status_code` lookup table, ~30 of which are "File Transferred to/from X" variants. Group transfers together.

**Files:**
- Create: `packages/web/src/lib/filing-status.ts`
- Modify: `packages/web/src/filings/FilingDetail.tsx:245-256` (header area)

**Step 1: Create `filing-status.ts`**

Classify statuses into semantic groups with colors. Use a function that checks both exact match and pattern matching (for transfers, pending variants, etc.):

```typescript
export type FilingStatusCategory =
  | 'closed'
  | 'active'
  | 'accepted'
  | 'action_taken'
  | 'pending'
  | 'review'
  | 'denied'
  | 'transferred'
  | 'blocked'
  | 'hearing'
  | 'other';

export type FilingStatusInfo = {
  category: FilingStatusCategory;
  label: string;       // short display label (may differ from raw statusText)
  bg: string;          // Tailwind bg classes
  text: string;        // Tailwind text classes
  terminal: boolean;   // whether this is a final state
};

/** Map of exact status codes/text → category. Transfers are matched by prefix below. */
const EXACT_STATUS_MAP: Record<string, Omit<FilingStatusInfo, 'label'>> = {
  // ICFS free-text statuses
  'Closed':                { category: 'closed',       bg: 'bg-neutral-200 dark:bg-neutral-700',   text: 'text-neutral-700 dark:text-neutral-300',  terminal: true },
  'Current':               { category: 'active',       bg: 'bg-green-100 dark:bg-green-900',       text: 'text-green-800 dark:text-green-200',      terminal: false },
  'Pending Review':        { category: 'pending',      bg: 'bg-amber-100 dark:bg-amber-900',       text: 'text-amber-800 dark:text-amber-200',      terminal: false },
  'Pending Payment':       { category: 'pending',      bg: 'bg-amber-100 dark:bg-amber-900',       text: 'text-amber-800 dark:text-amber-200',      terminal: false },
  'Pending Consummation':  { category: 'pending',      bg: 'bg-amber-100 dark:bg-amber-900',       text: 'text-amber-800 dark:text-amber-200',      terminal: false },
  // IBFS lookup-table codes
  'A/C':   { category: 'action_taken', bg: 'bg-blue-100 dark:bg-blue-900',      text: 'text-blue-800 dark:text-blue-200',      terminal: true },
  'ATPN':  { category: 'action_taken', bg: 'bg-blue-100 dark:bg-blue-900',      text: 'text-blue-800 dark:text-blue-200',      terminal: false },
  'AFPN':  { category: 'accepted',     bg: 'bg-sky-100 dark:bg-sky-900',        text: 'text-sky-800 dark:text-sky-200',        terminal: false },
  'AFSL':  { category: 'accepted',     bg: 'bg-sky-100 dark:bg-sky-900',        text: 'text-sky-800 dark:text-sky-200',        terminal: false },
  'AFP':   { category: 'accepted',     bg: 'bg-sky-100 dark:bg-sky-900',        text: 'text-sky-800 dark:text-sky-200',        terminal: false },
  'INP':   { category: 'other',        bg: 'bg-neutral-100 dark:bg-neutral-800', text: 'text-neutral-600 dark:text-neutral-400', terminal: false },
  'BLOK':  { category: 'blocked',      bg: 'bg-red-100 dark:bg-red-900',        text: 'text-red-800 dark:text-red-200',        terminal: false },
  'UNBLK': { category: 'active',       bg: 'bg-green-100 dark:bg-green-900',    text: 'text-green-800 dark:text-green-200',    terminal: false },
  'DREC':  { category: 'denied',       bg: 'bg-red-100 dark:bg-red-900',        text: 'text-red-800 dark:text-red-200',        terminal: true },
  'DSTAY': { category: 'denied',       bg: 'bg-red-100 dark:bg-red-900',        text: 'text-red-800 dark:text-red-200',        terminal: true },
  'GREC':  { category: 'action_taken', bg: 'bg-green-100 dark:bg-green-900',    text: 'text-green-800 dark:text-green-200',    terminal: false },
  'GSTAY': { category: 'action_taken', bg: 'bg-green-100 dark:bg-green-900',    text: 'text-green-800 dark:text-green-200',    terminal: false },
  'HEAR':  { category: 'hearing',      bg: 'bg-purple-100 dark:bg-purple-900',  text: 'text-purple-800 dark:text-purple-200',  terminal: false },
  'SFH':   { category: 'hearing',      bg: 'bg-purple-100 dark:bg-purple-900',  text: 'text-purple-800 dark:text-purple-200',  terminal: false },
  'RFH':   { category: 'hearing',      bg: 'bg-purple-100 dark:bg-purple-900',  text: 'text-purple-800 dark:text-purple-200',  terminal: false },
  'SUSP':  { category: 'blocked',      bg: 'bg-red-100 dark:bg-red-900',        text: 'text-red-800 dark:text-red-200',        terminal: false },
  'RECON': { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'AREV':  { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'TREV':  { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'TRC':   { category: 'review',       bg: 'bg-blue-100 dark:bg-blue-900',      text: 'text-blue-800 dark:text-blue-200',      terminal: false },
  'LRC':   { category: 'review',       bg: 'bg-blue-100 dark:bg-blue-900',      text: 'text-blue-800 dark:text-blue-200',      terminal: false },
  'LREV':  { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'INFO':  { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'COR':   { category: 'other',        bg: 'bg-neutral-100 dark:bg-neutral-800', text: 'text-neutral-600 dark:text-neutral-400', terminal: false },
  'DFT':   { category: 'other',        bg: 'bg-neutral-100 dark:bg-neutral-800', text: 'text-neutral-600 dark:text-neutral-400', terminal: false },
  'COOR':  { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
  'STAY':  { category: 'blocked',      bg: 'bg-red-100 dark:bg-red-900',        text: 'text-red-800 dark:text-red-200',        terminal: false },
  'RMD':   { category: 'review',       bg: 'bg-amber-100 dark:bg-amber-900',    text: 'text-amber-800 dark:text-amber-200',    terminal: false },
};

/** Transferred-to/from codes all get the same style */
const TRANSFERRED_INFO: Omit<FilingStatusInfo, 'label'> = {
  category: 'transferred',
  bg: 'bg-violet-100 dark:bg-violet-900',
  text: 'text-violet-800 dark:text-violet-200',
  terminal: false,
};

const FALLBACK_INFO: Omit<FilingStatusInfo, 'label'> = {
  category: 'other',
  bg: 'bg-neutral-100 dark:bg-neutral-800',
  text: 'text-neutral-600 dark:text-neutral-400',
  terminal: false,
};

/**
 * Resolve status info from a status code and/or status text.
 * Uses statusCode for lookup-table matches; falls back to statusText for ICFS free-text statuses.
 */
export function getFilingStatus(statusCode: string | null, statusText: string | null): FilingStatusInfo | null {
  if (statusCode == null && statusText == null) return null;

  // Try exact match on statusCode first
  if (statusCode != null) {
    const exact = EXACT_STATUS_MAP[statusCode];
    if (exact != null) {
      return { ...exact, label: statusText ?? statusCode };
    }
    // Transfer codes: F* (from) and T* (to) prefixes, plus TRN
    if (/^F[A-Z]/.test(statusCode) || /^T[A-Z]/.test(statusCode) || statusCode === 'TRN') {
      return { ...TRANSFERRED_INFO, label: statusText ?? 'Transferred' };
    }
  }

  // Try exact match on statusText (ICFS free-text)
  if (statusText != null) {
    const exact = EXACT_STATUS_MAP[statusText];
    if (exact != null) {
      return { ...exact, label: statusText };
    }
    // "Pending *" catch-all
    if (statusText.startsWith('Pending')) {
      return { ...EXACT_STATUS_MAP['Pending Review']!, label: statusText };
    }
  }

  // Fallback: show whatever we have
  return { ...FALLBACK_INFO, label: statusText ?? statusCode ?? '' };
}
```

Note: The transfer-prefix regex `F[A-Z]` catches `FCCB`, `FCGB`, etc. and `T[A-Z]` catches `TCCB`, `TEB`, `TSAT`, etc. Be careful that `TRC` (Technical Review Complete) and `TREV` (Under Technical Review) are in `EXACT_STATUS_MAP` and will match before the prefix check.

**Step 2: Add prominent status pill in filing detail header**

In `FilingDetail.tsx`, replace the existing secondary Badge with a colored status pill. Place it immediately after the file number heading, in the same `flex` row as the subsystem badge:

```tsx
{(() => {
  const status = getFilingStatus(filing.statusCode, filing.statusText);
  if (status != null) {
    return (
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${status.bg} ${status.text}`}>
        {status.label}
      </span>
    );
  }
  return null;
})()}
```

Remove the old `{filing.statusText != null && <Badge variant="secondary">{filing.statusText}</Badge>}`.

**Step 3: Verify**

- Check a `Closed` filing — neutral gray pill
- Check a `Current` filing — green pill
- Check an `ATPN` filing — blue pill
- Check a transferred filing — violet "Transferred" pill
- Check `Pending Review` — amber pill

**Step 4: Commit**
```
feat(filings): reify filing status codes with colors and prominent display
```

---

## Task 5: Timeline Milestone Sub-Categories

**Context:** `eventCategory()` in `FilingTimeline.tsx` maps ALL `filing_field` events to `'milestone'` (amber). The server already sends distinct `type` values: `filed`, `signed`, `granted`, `effective`, `expired`, `last_action`. We should give key milestones distinct colors and show them in the legend.

**Files:**
- Modify: `packages/web/src/filings/FilingTimeline.tsx:14-30` (CATEGORY_COLORS and eventCategory)

**Step 1: Expand CATEGORY_COLORS**

Replace the single `milestone` entry with individual milestone types:
```typescript
const CATEGORY_COLORS: Record<string, string> = {
  // Filing milestones
  filed: '#2563eb',       // blue-600
  signed: '#7c3aed',     // violet-600
  granted: '#16a34a',    // green-600
  effective: '#059669',  // emerald-600
  expired: '#dc2626',    // red-600
  last_action: '#b45309', // amber-700 (keep original milestone color)
  // Pleading types
  comment: '#525252',
  decision: '#9333ea',
  letter: '#2563eb',
  other: '#737373',
  petition: '#d97706',
  supplement: '#0d9488',
};
```

**Step 2: Update eventCategory**

```typescript
function eventCategory(e: TimelineEvent): string {
  if (e.source === 'filing_field') {
    return CATEGORY_COLORS[e.type] != null ? e.type : 'last_action';
  }
  return CATEGORY_COLORS[e.type] != null ? e.type : 'other';
}
```

**Step 3: Verify**

- Navigate to a filing detail page with multiple timeline events
- Each milestone type should have its own color in the chart and legend

**Step 4: Commit**
```
feat(filings): distinguish milestone types with unique colors in timeline
```

---

## Task 6: Sortable Attachment List on Filing Detail

**Context:** The filing detail attachment table is a plain `<table>`. Replace it with the existing `SimpleDataTable` component (already used on the home page for recent filings) or add sort-on-click to the existing table headers.

**Files:**
- Modify: `packages/web/src/filings/FilingDetail.tsx:390-440` (attachment table)

**Step 1: Import useReactTable and sorting utilities**

The `SimpleDataTable` in `HomePage.tsx` is a local component. Either extract it to a shared component or use TanStack Table directly. Since `SimpleDataTable` is simple, the easiest path is to use TanStack Table inline (the pattern already exists in the file for the petitions table — check if it does; if not, model it on the home page).

Actually, the simplest approach: add `useState` for sort column/direction, then sort `filing.attachments` in a `useMemo` before rendering. Keep the existing `<table>` markup and add click handlers to `<th>` elements.

```tsx
const [attSort, setAttSort] = useState<{ col: 'attachmentName' | 'description' | 'fileSizeBytes'; dir: 'asc' | 'desc' }>({ col: 'attachmentName', dir: 'asc' });

const sortedAttachments = useMemo(() => {
  const sorted = [...filing.attachments];
  sorted.sort((a, b) => {
    const aVal = a[attSort.col];
    const bVal = b[attSort.col];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
    return attSort.dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}, [filing.attachments, attSort]);
```

Add click handlers and sort indicators to each `<th>`.

**Step 2: Verify**

- Click Name header — sorts alphabetically
- Click Size header — sorts by file size
- Click again — reverses direction

**Step 3: Commit**
```
feat(filings): make attachment list sortable by name, description, and size
```

---

## Task 7: Home Page — Comment & Attachment Counts

**Context:** The "Total Filings" card shows only `stats.filing_count`. Need to also show comment and attachment counts, smaller, below the filing number.

**Files:**
- Modify: `packages/server/src/stats/repository.ts` (in `getPublicStats` or wherever `filing_count` is returned)
- Modify: `packages/server/src/stats/types.ts` (add fields to `PublicStats`)
- Modify: `packages/web/src/home/HomePage.tsx:430-435` (Total Filings card) and frontend type

**Step 1: Add counts to the API**

In the stats repository function that returns `filing_count`, add:
```sql
SELECT count(*)::INTEGER AS cnt FROM pleading
-- and
SELECT count(*)::INTEGER AS cnt FROM attachment
```

Add `comment_count` and `attachment_count` to the response type.

**Step 2: Update frontend type and display**

In `HomePage.tsx`, update `PublicStats` type. In the Total Filings card, add below the filing count:
```tsx
<div className="mt-2 flex gap-4 text-xs text-neutral-500 dark:text-neutral-400">
  <span>{stats.comment_count.toLocaleString()} comments</span>
  <span>{stats.attachment_count.toLocaleString()} attachments</span>
</div>
```

**Step 3: Verify and commit**
```
feat(home): show comment and attachment counts on Total Filings card
```

---

## Task 8: M&A Activity Link to Ownership Events Page

**Context:** The M&A Activity card shows a count. Create a new `/ownership-events` page with a simple list of recent events, and link the card to it.

**Files:**
- Create: `packages/web/src/companies/OwnershipEventsPage.tsx`
- Modify: `packages/web/src/App.tsx` (add route)
- Modify: `packages/server/src/companies/routes.ts` (add public endpoint)
- Modify: `packages/server/src/companies/repository.ts` (add `listRecentOwnershipEvents`)
- Modify: `packages/web/src/home/HomePage.tsx:441-448` (wrap in Link)

**Step 1: Add server endpoint**

Add `GET /api/ownership-events` with optional `?limit=50` parameter. Query:
```sql
SELECT oe.event_id, oe.filing_file_number, oe.event_type, oe.status,
       oe.effective_date, oe.description,
       tc.name AS transferor_name, te.name AS transferee_name
FROM ownership_event oe
LEFT JOIN company tc ON tc.id = oe.transferor_company_id
LEFT JOIN company te ON te.id = oe.transferee_company_id
ORDER BY oe.effective_date DESC NULLS LAST
LIMIT ?
```

**Step 2: Create placeholder page**

`OwnershipEventsPage.tsx` — simple page with:
- Title "M&A Activity"
- Subtitle "Recent ownership events from FCC Transfer of Control and Assignment filings"
- A `SimpleTable` or TanStack Table with columns: Date, Type, Transferor, Transferee, Filing, Status

Use existing patterns from `CompaniesPage.tsx`.

**Step 3: Add route**

In `App.tsx`, add `<Route path="/ownership-events" element={<OwnershipEventsPage />} />` inside the public layout.

**Step 4: Link the home page card**

Wrap the M&A Activity card content in a `<Link to="/ownership-events">` or make the whole card clickable.

**Step 5: Verify and commit**
```
feat(companies): add ownership events list page and link from home
```

---

## Task 9: Company Volume Chart — 3 Months → 6 Months

**Context:** `getRecentFilingVolumeByCompany` in `packages/server/src/stats/repository.ts:201` uses `INTERVAL '2 months'` (current month + 2 prior = 3 months). Change to `INTERVAL '5 months'` for 6 months. Update the frontend label.

**Files:**
- Modify: `packages/server/src/stats/repository.ts:201`
- Modify: `packages/web/src/home/HomePage.tsx` (two label strings referencing "3 Months")

**Step 1: Update SQL**

Change:
```sql
AND f.date_filed >= date_trunc('month', CURRENT_DATE) - INTERVAL '2 months'
```
to:
```sql
AND f.date_filed >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
```

**Step 2: Update labels**

In `HomePage.tsx`, find the two strings `Last 3 Months` and change to `Last 6 Months`.

**Step 3: Verify and commit**
```
feat(home): extend company filing volume chart from 3 to 6 months
```

---

## Task 10: Collapsible Lower Home Page Cards

**Context:** The 3 lower full-width cards on the home page are: "Last 6 Months Filing Volume by Company" (after Task 9), "Total Filings by Subsystem", and "Historical Filing Volume by Year". Make them collapsible but open by default.

**Files:**
- Modify: `packages/web/src/home/HomePage.tsx`

**Step 1: Create a CollapsibleCard wrapper**

Add a small local component (or inline it) that wraps each card:

```tsx
function CollapsibleCard({ children, defaultOpen = true, title, subtitle }: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
  subtitle?: string;
}) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  return (
    <div className={cardClass}>
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
        <div>
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{title}</p>
          {subtitle && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
```

Import `ChevronDown` and `ChevronRight` from `lucide-react`.

**Step 2: Wrap the 3 lower cards**

Replace each card's outer `<div className={cardClass}>` + heading with `<CollapsibleCard title="..." subtitle="...">` and move the card body into the children.

**Step 3: Verify and commit**
```
feat(home): make lower stat cards collapsible with open-by-default
```

---

## Task 11: Move AI Config Settings from Config Page to AI Page

**Context:** The Config page (`ConfigEditor.tsx`) shows ALL config entries in a generic key-value table. The AI page (`AiSettings.tsx`) already has dedicated UI for `bedrockRegion`, `bedrockDefaultModel`, `summarizationModel`, and summarization prompts. But `newsSummarizationModel`, `newsSummarizationSystemPrompt`, `newsSummarizationUserPrompt`, `embeddingModel`, `embeddingDimensions`, and `embeddingNormalize` are only shown in the generic Config table. Move them to the AI page with proper UI elements. Put prompts in collapsible cards since they take up space.

**Files:**
- Modify: `packages/web/src/admin/AiSettings.tsx`
- Modify: `packages/web/src/admin/ConfigEditor.tsx` (filter out AI keys from generic table)

**Step 1: Define AI config keys to hide from generic table**

In `ConfigEditor.tsx`, filter out AI-related keys from the entries list so they don't appear in the generic table:

```typescript
const AI_CONFIG_KEYS = new Set([
  'bedrockRegion', 'bedrockDefaultModel',
  'summarizationModel', 'summarizationSystemPrompt', 'summarizationUserPrompt',
  'newsSummarizationModel', 'newsSummarizationSystemPrompt', 'newsSummarizationUserPrompt',
  'embeddingModel', 'embeddingDimensions', 'embeddingNormalize',
]);
```

Filter: `entries.filter(e => !AI_CONFIG_KEYS.has(e.key))`

**Step 2: Add news summarization section to AI page**

Model it on the existing summarization section:
- A "News Summarization Model" card with the same radio-button model selector pattern
- Fetch the news prompt template from the API (`/api/admin/inference/prompt-templates` — check if it already returns a `newsSummarization` key, or add it)
- A collapsible `PromptEditor` for news summarization prompts

**Step 3: Add embedding config section to AI page**

Add a card for embedding settings:
- `embeddingModel`: text input or dropdown (if models are known)
- `embeddingDimensions`: dropdown with options 256, 512, 1024
- `embeddingNormalize`: toggle/checkbox

**Step 4: Make prompt sections collapsible**

Wrap each `PromptEditor` in a collapsible container (similar to Task 10's `CollapsibleCard`). The `PromptEditor` component already has its own collapsible sections internally — but the whole prompt editor card should be collapsible too. Use `ChevronDown`/`ChevronRight` pattern.

**Step 5: Save all settings together**

Extend the existing `handleSaveConfig` in `AiSettingsInner` to also save the news summarization and embedding config keys.

**Step 6: Verify**

- Admin → Config should only show `betterAuthSecret`, `betterAuthUrl`, `clientDomain`
- Admin → AI should show all AI settings with proper UI
- Save and reload — values should persist

**Step 7: Commit**
```
refactor(admin): move AI config settings from Config page to AI page
```

---

## Execution Notes

- Tasks 1–3, 5–7, 9–10 are small (15-30 min each).
- Tasks 4 and 8 are medium (require new files/endpoints).
- Task 11 is the largest (significant AiSettings.tsx rework).
- Tasks are independent except: Task 10 references Task 9's label change. Task 4's `FilingStatus` type could be reused in Task 5 for milestone colors, but they're separate enough to do independently.
- Run `make test` after each commit. Run `make dev` and visually verify each UI change.
