# Edition Navigation Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subtle prev/next edition navigation buttons flanking the dateline in the newspaper masthead, nearly invisible at rest and revealing direction labels on hover.

**Architecture:** A new `GET /api/newspaper/edition/:date/adjacent` endpoint returns `{ prev: string|null, next: string|null }` ISO dates. `NewspaperView` fetches these alongside the existing news/filings calls and passes them to `Masthead`. `Masthead` renders two ghost buttons that use `useNavigate()` to push the user to `/newspaper/:date`.

**Tech Stack:** Hono (server routes), DuckDB (repository), React + react-router v7 (frontend navigation), CSS transitions (hover effects)

---

## File Map

| File | Change |
|------|--------|
| `packages/server/src/newspaper/repository.ts` | Add `getAdjacentEditions(conn, date)` |
| `packages/server/src/newspaper/repository.test.ts` | Test `getAdjacentEditions` |
| `packages/server/src/newspaper/routes.ts` | Add `GET /edition/:date/adjacent` route |
| `packages/web/src/newspaper/NewspaperView.tsx` | Fetch adjacent dates; pass to Masthead |
| `packages/web/src/newspaper/Masthead.tsx` | Accept `prevDate`/`nextDate` props; render nav buttons |
| `packages/web/src/newspaper/newspaper.css` | Ghost button styles + hover transitions |

---

### Task 1: Repository — `getAdjacentEditions`

**Files:**
- Modify: `packages/server/src/newspaper/repository.ts`
- Test: `packages/server/src/newspaper/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/server/src/newspaper/repository.test.ts` and add this describe block after the existing `getLatestEdition` tests:

```ts
describe('getAdjacentEditions', () => {
  it('returns prev and next dates when neighbours exist', async () => {
    await ensureEdition(conn, '2026-03-25');
    await ensureEdition(conn, '2026-03-26');
    await ensureEdition(conn, '2026-03-27');

    const result = await getAdjacentEditions(conn, '2026-03-26');
    expect(result).toEqual({ prev: '2026-03-25', next: '2026-03-27' });
  });

  it('returns null for prev when it is the oldest edition', async () => {
    await ensureEdition(conn, '2026-03-25');
    await ensureEdition(conn, '2026-03-26');

    const result = await getAdjacentEditions(conn, '2026-03-25');
    expect(result).toEqual({ prev: null, next: '2026-03-26' });
  });

  it('returns null for next when it is the newest edition', async () => {
    await ensureEdition(conn, '2026-03-25');
    await ensureEdition(conn, '2026-03-26');

    const result = await getAdjacentEditions(conn, '2026-03-26');
    expect(result).toEqual({ prev: '2026-03-25', next: null });
  });

  it('returns null for both when only one edition exists', async () => {
    await ensureEdition(conn, '2026-03-26');

    const result = await getAdjacentEditions(conn, '2026-03-26');
    expect(result).toEqual({ prev: null, next: null });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/server && pnpm test src/newspaper/repository.test.ts
```

Expected: FAIL — `getAdjacentEditions is not a function`

- [ ] **Step 3: Add `getAdjacentEditions` to the repository**

In `packages/server/src/newspaper/repository.ts`, add this function (place it near `getEditionByDate`):

```ts
export async function getAdjacentEditions(
  conn: DuckDBConnection,
  date: string,
): Promise<{ prev: string | null; next: string | null }> {
  const reader = await conn.runAndReadAll(
    `SELECT
       MAX(CASE WHEN edition_date < CAST(? AS DATE) THEN CAST(edition_date AS VARCHAR) END) AS prev,
       MIN(CASE WHEN edition_date > CAST(? AS DATE) THEN CAST(edition_date AS VARCHAR) END) AS next
     FROM newspaper_edition`,
    [date, date] as DuckDBValue[],
  );
  const row = reader.getRowObjectsJS()[0] as Record<string, unknown>;
  return {
    prev: row.prev != null ? String(row.prev).slice(0, 10) : null,
    next: row.next != null ? String(row.next).slice(0, 10) : null,
  };
}
```

The `.slice(0, 10)` trims any time component DuckDB may append to the date string (e.g. `2026-03-25 00:00:00`).

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd packages/server && pnpm test src/newspaper/repository.test.ts
```

Expected: all `getAdjacentEditions` cases PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/repository.ts packages/server/src/newspaper/repository.test.ts
git commit -m "feat(newspaper): add getAdjacentEditions repository method"
```

---

### Task 2: API Route — `GET /edition/:date/adjacent`

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

- [ ] **Step 1: Import `getAdjacentEditions`**

In `packages/server/src/newspaper/routes.ts`, add `getAdjacentEditions` to the existing import from `./repository.ts`:

```ts
import {
  deleteEdition,
  getAdjacentEditions,          // ← add
  getArticlesByEdition,
  getEditionByDate,
  getHouseAdForDate,
  getImageByPath,
  getLatestEdition,
  listEditions,
  listImagesByType,
  publishEdition,
  resetArticle,
  unpublishEdition,
  updateArticle,
} from './repository.ts';
```

- [ ] **Step 2: Add the route**

Insert this block immediately after the `GET /edition/:date/news` route (around line 115):

```ts
/** GET /api/newspaper/edition/:date/adjacent — prev and next edition dates */
newspaperRoutes.get('/edition/:date/adjacent', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }
  const result = await withConn((conn) => getAdjacentEditions(conn, date));
  return c.json(result);
});
```

- [ ] **Step 3: Smoke-test the route manually**

With the API server running locally:

```bash
curl http://localhost:3001/api/newspaper/edition/2026-03-27/adjacent
```

Expected: `{"prev":"2026-03-26","next":"2026-03-28"}` (dates will vary based on your DB content). A date with no neighbours returns `{"prev":null,"next":null}`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/newspaper/routes.ts
git commit -m "feat(newspaper): add GET /edition/:date/adjacent route"
```

---

### Task 3: Frontend — Fetch Adjacent Dates in `NewspaperView`

**Files:**
- Modify: `packages/web/src/newspaper/NewspaperView.tsx`

The component currently fetches filings and news in parallel after loading the edition. We add adjacent dates to that same parallel fetch.

- [ ] **Step 1: Add state + fetch**

In `NewspaperView`, add a state variable and update `fetchEdition`:

```tsx
// Add near the other useState declarations (around line 70):
const [adjacentDates, setAdjacentDates] = useState<{ prev: string | null; next: string | null }>({
  prev: null,
  next: null,
});
```

Inside `fetchEdition`, update the parallel fetch block (currently fetches `filings` and `news`):

```tsx
const editionDate: string = data.editionDate;
const [filings, news, adjacent] = await Promise.all([
  apiFetch<RecentFilingsResponse>('/api/stats/recent-filings'),
  apiFetch<PaginatedNewsResponse>(`/api/newspaper/edition/${editionDate}/news`),
  apiFetch<{ prev: string | null; next: string | null }>(
    `/api/newspaper/edition/${editionDate}/adjacent`,
  ),
]);
setRecentFilings(filings);
setNewsItems(news.data);
setAdjacentDates(adjacent);
```

- [ ] **Step 2: Pass adjacent dates to `Masthead`**

Find the `<Masthead editionDate={edition.editionDate} />` line (around line 152) and update it:

```tsx
<Masthead
  editionDate={edition.editionDate}
  nextDate={adjacentDates.next}
  prevDate={adjacentDates.prev}
/>
```

- [ ] **Step 3: Verify the app still compiles (TypeScript will complain about unknown props — that's expected until Task 4)**

```bash
cd packages/web && pnpm build 2>&1 | head -20
```

Expected: TypeScript error about `prevDate`/`nextDate` not existing on `MastheadProps`. That's fine — Task 4 adds them.

- [ ] **Step 4: Commit** (after Task 4 makes it compile cleanly)

Hold this commit until the end of Task 4.

---

### Task 4: Masthead — Navigation Button Props + Render

**Files:**
- Modify: `packages/web/src/newspaper/Masthead.tsx`

- [ ] **Step 1: Add import for `useNavigate`**

Add to the top of `Masthead.tsx`:

```tsx
import { useNavigate } from 'react-router';
```

- [ ] **Step 2: Update `MastheadProps` and the component signature**

```tsx
type MastheadProps = {
  editionDate: string;
  nextDate?: string | null;
  prevDate?: string | null;
};

export default function Masthead({ editionDate, prevDate, nextDate }: MastheadProps) {
```

- [ ] **Step 3: Add `useNavigate` inside the component and update the dateline render**

Replace the existing `<p className="masthead-dateline">` element with:

```tsx
const navigate = useNavigate();

// … (keep existing useState and formatDateLine/roman as-is) …

// Replace the <p className="masthead-dateline"> element:
<div className="masthead-dateline">
  <button
    aria-label="Previous edition"
    className="masthead-edition-nav masthead-edition-nav--prev"
    disabled={!prevDate}
    onClick={() => prevDate && void navigate(`/newspaper/${prevDate}`)}
    title="Previous edition"
    type="button"
  >
    ← Prev
  </button>
  <span>{formatDateLine(editionDate)}</span>
  <button
    aria-label="Next edition"
    className="masthead-edition-nav masthead-edition-nav--next"
    disabled={!nextDate}
    onClick={() => nextDate && void navigate(`/newspaper/${nextDate}`)}
    title="Next edition"
    type="button"
  >
    Next →
  </button>
</div>
```

Note: `.masthead-dateline` already has `border-top` and `padding-top` set in CSS; that will now apply to the wrapper `div`, which is the correct behaviour.

- [ ] **Step 4: Commit NewspaperView + Masthead together**

```bash
git add packages/web/src/newspaper/NewspaperView.tsx packages/web/src/newspaper/Masthead.tsx
git commit -m "feat(newspaper): wire adjacent-edition nav into Masthead"
```

---

### Task 5: CSS — Ghost Button Styles

**Files:**
- Modify: `packages/web/src/newspaper/newspaper.css`

- [ ] **Step 1: Convert `.masthead-dateline` to flex and add button styles**

The current `.masthead-dateline` block (around line 208) sets the typography for the dateline text. We change it to a flex container and add button rules.

Replace the existing `.masthead-dateline` block:

```css
.masthead-dateline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  font-family: var(--np-font-body);
  font-size: 11px;
  font-variant: small-caps;
  letter-spacing: 1.5px;
  color: var(--np-sepia-medium);
  margin-top: 0.5rem;
  border-top: 1px solid var(--np-sepia-medium);
  padding-top: 0.5rem;
}
```

Then add the button styles immediately after:

```css
.masthead-edition-nav {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--np-sepia-medium);
  border-radius: 2px;
  background: transparent;
  color: var(--np-sepia-medium);
  font-family: var(--np-font-body);
  font-size: 10px;
  font-variant: small-caps;
  letter-spacing: 1px;
  cursor: pointer;
  opacity: 0.15;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.masthead-edition-nav:hover:not(:disabled) {
  opacity: 1;
}

.masthead-edition-nav:disabled {
  opacity: 0;
  pointer-events: none;
}
```

`opacity: 0.15` makes the button nearly invisible at rest. `:hover` brings it to full opacity. `:disabled` hides it entirely (when there's no prev/next edition).

- [ ] **Step 2: Check in browser**

With both servers hot-reloading, open the newspaper home page. The dateline should look identical to before. Moving the mouse to the far left or far right of the dateline line should cause a faint button to materialize, then show full text on hover.

Adjust `opacity: 0.15` up or down to taste — this is the "nearly invisible" tuning knob.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/newspaper/newspaper.css
git commit -m "feat(newspaper): ghost nav button styles for edition navigation"
```

---

## Final Verification

- [ ] Navigate to the newspaper home page (latest edition). Both buttons should be present in the DOM; "Next →" should be invisible (disabled) since it's the latest. "← Prev" should appear on hover and navigate to the prior dated URL.
- [ ] Navigate to an intermediate dated edition (e.g. `/newspaper/2026-03-26`). Both buttons should appear on hover and navigate correctly.
- [ ] Navigate to the oldest edition in the DB. "← Prev" should be invisible (disabled).
- [ ] Run the full test suite: `pnpm test` from the repo root.
