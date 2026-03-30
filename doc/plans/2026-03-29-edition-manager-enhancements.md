# Edition Manager Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add date-specific newspaper generation, regeneration of existing editions, and content slot visibility to the Edition Manager admin UI.

**Architecture:** Four features layered on the existing Edition Manager stack: (1) a server-side generation endpoint that reuses the existing `slot-dispatcher` + CLI pipeline logic, (2) a "Generate for Date" UI with a date picker on the EditionBrowser page, (3) a "Regenerate" button on existing editions that deletes then re-generates, (4) an enhanced EditionDetail page that shows all expected content slots for a date — including missing ones — with generate buttons and links to each slot's prompt settings. The AI Settings page gains query-param deep-linking support so content slots can link directly to their prompt editor.

**Tech Stack:** React (frontend), Hono (API), DuckDB (database), Tailwind CSS + Radix UI (styling), HTML5 `<input type="date">` (date picker — no new dependencies needed)

---

## Preliminary Notes

### Key Files
| Layer | File | Purpose |
|---|---|---|
| **Server types** | `packages/server/src/newspaper/types.ts` | `NewspaperContentType`, `GenerateOptions`, etc. |
| **Rotation schedule** | `packages/server/src/newspaper/rotation.ts` | `getContentTypesForDay()`, slot schedules |
| **Slot dispatcher** | `packages/server/src/newspaper/slot-dispatcher.ts` | `dispatchSlot()`, `SLUG_MAP`, `DISPLAY_ORDER_MAP` |
| **Repository** | `packages/server/src/newspaper/repository.ts` | All DB CRUD operations |
| **API routes** | `packages/server/src/newspaper/routes.ts` | `newspaperRoutes` + `newspaperAdminRoutes` |
| **CLI generate** | `packages/server/src/cli/newspaper/index.ts` | `setupGenerateContext`, `CONTENT_TYPES`, generate loop |
| **EditionBrowser** | `packages/web/src/admin/newspaper/EditionBrowser.tsx` | Edition list page |
| **EditionDetail** | `packages/web/src/admin/newspaper/EditionDetail.tsx` | Per-edition article management |
| **AI Settings** | `packages/web/src/admin/AiSettings.tsx` | Unified prompt editor (uses `selectedSlug` state) |
| **Prompt registry** | `packages/server/src/inference/prompt-registry.ts` | Maps content types to prompt slugs (e.g., `newspaper-daily-digest`) |
| **Inference singleton** | `packages/server/src/inference/index.ts` | `getInferenceService()` — server-side singleton |

### Content Type → Prompt Registry Slug Mapping
The prompt registry uses slugs like `newspaper-daily-digest`, `newspaper-editorial`, etc. The mapping from `NewspaperContentType` to prompt slug is: replace underscores with hyphens and prefix with `newspaper-`. Exceptions: `hero_image` and `editorial_cartoon` are image generators with no text prompts.

### Content Slots for a Date
For any given date, the expected content types are:
- **Always (5):** `daily_digest`, `hero_image`, `fake_ad`, `editorial_cartoon`, `classifieds`
- **Weekdays (3 more):** Determined by `getContentTypesForDay(dayOfWeek)` — one each from Slot A, Slot B, Slot C schedules
- **Weekends:** Only the 5 daily types (slots return null)

### Display Names
The frontend already has `DISPLAY_NAME_MAP` in `packages/web/src/newspaper/types.ts` mapping content types to human-readable names.

---

## Task 1: Extract Shared Generation Service (Server)

The CLI `generate` command inlines all generation logic. The API server needs to trigger generation too. Extract the core logic into a reusable service function.

**Files:**
- Create: `packages/server/src/newspaper/generate-service.ts`
- Modify: `packages/server/src/newspaper/routes.ts` (will use the service in Task 3)

**Step 1: Create the generation service module**

Create `packages/server/src/newspaper/generate-service.ts` with a `generateEdition()` function that:
1. Accepts `conn: DuckDBConnection`, `editionDate: string`, `contentTypes?: NewspaperContentType[]` (optional filter — defaults to all types for the day)
2. Calls `ensureEdition(conn, editionDate)` to upsert the edition row
3. Determines which content types to run:
   - If `contentTypes` is provided, use those
   - Otherwise, compute `DAILY_TYPES` + rotation types for the date (same logic as CLI)
4. For each type, checks idempotency (skip if `status === 'generated'`)
5. Gets `ConfigService` via `getConfigService()`, `InferenceService` via `getInferenceService()`
6. Loads and runs the generator via `loadGenerator()` from `slot-dispatcher.ts` (reuse, not duplicate)
7. Upserts each article via `upsertArticle()`
8. Marks edition `complete` when all types finish
9. Returns a results summary: `{ editionId, date, generated: string[], skipped: string[], failed: string[] }`

Important: The existing `loadGenerator()` in `slot-dispatcher.ts` handles text generators but NOT `hero_image` and `editorial_cartoon` (which need an `imageClient` / `InstrumentedBedrockClient`). The `daily_digest` generator is also missing from `loadGenerator()` — it's only in the CLI's `CONTENT_TYPES` map.

To handle this properly, the service should use a complete generator registry similar to the CLI's `CONTENT_TYPES`, but create the `InstrumentedBedrockClient` from the server's existing singleton infrastructure.

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewspaperContentType } from './types.ts';
import { getConfigService } from '../lib/config.ts';
import { getInferenceService } from '../inference/index.ts';

const DAILY_TYPES: NewspaperContentType[] = [
  'daily_digest', 'hero_image', 'fake_ad', 'editorial_cartoon', 'classifieds',
];

export type GenerateResult = {
  editionId: number;
  date: string;
  generated: string[];
  skipped: string[];
  failed: Array<{ slug: string; error: string }>;
};

export async function generateEdition(
  conn: DuckDBConnection,
  editionDate: string,
  contentTypes?: NewspaperContentType[],
): Promise<GenerateResult> {
  const { ensureEdition, upsertArticle, getArticle, updateEditionStatus } =
    await import('./repository.ts');
  const { ensureNewspaperTables } = await import('./schema.ts');
  const { ensureNewsTables } = await import('../news/schema.ts');
  const { ensureCompanyTables } = await import('../companies/schema.ts');

  await ensureNewspaperTables(conn);
  await ensureNewsTables(conn);
  await ensureCompanyTables(conn);

  const edition = await ensureEdition(conn, editionDate);
  await updateEditionStatus(conn, edition.id, 'generating');

  const config = getConfigService();
  const inferenceService = getInferenceService();

  // Determine types to generate
  let typesToRun: NewspaperContentType[];
  if (contentTypes != null && contentTypes.length > 0) {
    typesToRun = contentTypes;
  } else {
    const { getContentTypesForDay } = await import('./rotation.ts');
    const dayOfWeek = new Date(editionDate + 'T12:00:00Z').getUTCDay() as
      0 | 1 | 2 | 3 | 4 | 5 | 6;
    const slots = getContentTypesForDay(dayOfWeek);
    const rotationTypes: NewspaperContentType[] = [
      slots.slotA, slots.slotB, slots.slotC,
    ].filter((t): t is NewspaperContentType => t != null);
    typesToRun = [...DAILY_TYPES, ...rotationTypes];
  }

  const { SLUG_MAP, DISPLAY_ORDER_MAP } = await import('./slot-dispatcher.ts');
  const result: GenerateResult = {
    editionId: edition.id,
    date: editionDate,
    generated: [],
    skipped: [],
    failed: [],
  };

  for (const contentType of typesToRun) {
    const slug = SLUG_MAP[contentType];

    // Idempotency check
    const existing = await getArticle(conn, edition.id, slug);
    if (existing?.status === 'generated') {
      result.skipped.push(slug);
      continue;
    }

    try {
      const generator = await loadGeneratorFull(contentType);
      const genResult = await generator({
        conn,
        editionId: edition.id,
        editionDate,
        inferenceService,
        config,
        log: (_level: string, _msg: string) => { /* server-side: use structured logger if needed */ },
      });

      const modelKey = contentType === 'hero_image' || contentType === 'editorial_cartoon'
        ? 'newspaperImageModel' : 'newspaperCopyModel';

      await upsertArticle(conn, edition.id, {
        contentType,
        slug,
        headline: genResult.headline,
        body: genResult.body,
        imagePath: genResult.imagePath ?? null,
        imagePrompt: genResult.imagePrompt ?? null,
        sourceData: JSON.stringify(genResult.sourceData),
        generatedBy: config.get(modelKey) as string,
        displayOrder: DISPLAY_ORDER_MAP[contentType],
        status: 'generated',
      });

      result.generated.push(slug);
    } catch (err) {
      result.failed.push({
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Mark complete if no failures
  if (result.failed.length === 0) {
    await updateEditionStatus(conn, edition.id, 'complete');
  }

  return result;
}
```

Note: `loadGeneratorFull()` is a new helper that covers ALL content types (including `daily_digest`, `hero_image`, `editorial_cartoon`) — extending `loadGenerator()` from slot-dispatcher. For image generators (`hero_image`, `editorial_cartoon`), the function needs to create an `InstrumentedBedrockClient` using server infrastructure. Check how `hero_image` and `editorial_cartoon` generators are called in the CLI — they receive an `imageClient` in their options. You'll need to adapt the `GenerateOptions` or wrap the call.

Look at the CLI code carefully:
- `hero_image` calls `generateHeroImage({ ..., imageClient: ctx.imageClient })` — it takes `imageClient` as an extra option
- `editorial_cartoon` calls `generateEditorialCartoon({ ..., imageClient: ctx.imageClient })`

These generators accept an extended options type. The service should create an `InstrumentedBedrockClient` similarly to how `getInferenceService()` creates one in `packages/server/src/inference/index.ts`, but pass the current `conn` for logging.

**Step 2: Verify the module compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors related to `generate-service.ts`

**Step 3: Commit**

```bash
git add packages/server/src/newspaper/generate-service.ts
git commit -m "feat(newspaper): extract shared generation service for API + CLI reuse"
```

---

## Task 2: Add Generate Edition API Endpoint (Server)

Add `POST /api/admin/newspaper/generate/:date` and `POST /api/admin/newspaper/generate/:date/:slug` endpoints.

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

**Step 1: Add the generate-all endpoint**

In `routes.ts`, add to the `newspaperAdminRoutes` router:

```typescript
/** POST /api/admin/newspaper/generate/:date — generate (or fill missing) an edition */
newspaperAdminRoutes.post('/generate/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    const { generateEdition } = await import('./generate-service.ts');
    return generateEdition(conn, date);
  });

  return c.json(result);
});
```

**Step 2: Add the generate-single-slot endpoint**

```typescript
/** POST /api/admin/newspaper/generate/:date/:slug — generate a single content slot */
newspaperAdminRoutes.post('/generate/:date/:slug', async (c) => {
  const date: string = c.req.param('date');
  const slug: string = c.req.param('slug');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  // Reverse-lookup: slug → contentType
  const { SLUG_MAP } = await import('./slot-dispatcher.ts');
  const contentType = (Object.entries(SLUG_MAP) as Array<[NewspaperContentType, string]>)
    .find(([, s]) => s === slug)?.[0];

  if (contentType == null) {
    return c.json({ error: `Unknown article slug: ${slug}` }, 400);
  }

  const result = await withConn(async (conn) => {
    const { generateEdition } = await import('./generate-service.ts');
    // Reset article to pending first so generation isn't skipped
    const { getEditionByDate, resetArticle } = await import('./repository.ts');
    const edition = await getEditionByDate(conn, date);
    if (edition) {
      await resetArticle(conn, edition.id, slug);
    }
    return generateEdition(conn, date, [contentType]);
  });

  return c.json(result);
});
```

**Step 3: Add the regenerate-edition endpoint (delete + regenerate)**

```typescript
/** POST /api/admin/newspaper/regenerate/:date — delete and regenerate an entire edition */
newspaperAdminRoutes.post('/regenerate/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    const { deleteEdition } = await import('./repository.ts');
    await deleteEdition(conn, date);
    const { generateEdition } = await import('./generate-service.ts');
    return generateEdition(conn, date);
  });

  return c.json(result);
});
```

**Step 4: Verify compilation**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/server/src/newspaper/routes.ts
git commit -m "feat(newspaper): add generate/regenerate API endpoints for admin UI"
```

---

## Task 3: Add Content Slots Manifest Endpoint (Server)

The EditionDetail page needs to know ALL expected content slots for a date, not just the ones that already exist. Add an endpoint that returns the slot manifest.

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

**Step 1: Add the slots manifest endpoint**

```typescript
/** GET /api/newspaper/edition/:date/slots — expected content slots for the date */
newspaperRoutes.get('/edition/:date/slots', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const { getContentTypesForDay } = await import('./rotation.ts');
  const { SLUG_MAP, DISPLAY_ORDER_MAP } = await import('./slot-dispatcher.ts');

  const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const slots = getContentTypesForDay(dayOfWeek);

  const DAILY_TYPES: NewspaperContentType[] = [
    'daily_digest', 'hero_image', 'fake_ad', 'editorial_cartoon', 'classifieds',
  ];

  const rotationTypes: NewspaperContentType[] = [
    slots.slotA, slots.slotB, slots.slotC,
  ].filter((t): t is NewspaperContentType => t != null);

  const allTypes = [...DAILY_TYPES, ...rotationTypes];

  // Build a mapping from content type to prompt registry slug
  const promptSlugMap: Record<string, string | null> = {};
  const IMAGE_TYPES = new Set(['hero_image', 'editorial_cartoon']);
  for (const ct of allTypes) {
    promptSlugMap[ct] = IMAGE_TYPES.has(ct)
      ? null  // image generators have no text prompt
      : `newspaper-${ct.replace(/_/g, '-')}`;
  }

  const manifest = allTypes.map((ct) => ({
    contentType: ct,
    slug: SLUG_MAP[ct],
    displayOrder: DISPLAY_ORDER_MAP[ct],
    promptSlug: promptSlugMap[ct],
    slotGroup: DAILY_TYPES.includes(ct) ? 'daily' :
      ct === slots.slotA ? 'slotA' :
      ct === slots.slotB ? 'slotB' : 'slotC',
  }));

  return c.json(manifest);
});
```

Note: You'll need to import `NewspaperContentType` at the top of routes.ts.

**Step 2: Verify compilation**

Run: `cd packages/server && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/server/src/newspaper/routes.ts
git commit -m "feat(newspaper): add content slots manifest endpoint"
```

---

## Task 4: Add Deep-Link Support to AI Settings Page (Frontend)

The AI Settings page uses `selectedSlug` state but doesn't read from URL params. Add `?prompt=<slug>` query param support so content slots can link directly to their prompt editor.

**Files:**
- Modify: `packages/web/src/admin/AiSettings.tsx`

**Step 1: Read from query params on mount**

In the `UnifiedPromptEditor` component (or its parent), add `useSearchParams` from `react-router`:

```typescript
import { useSearchParams } from 'react-router';
```

Then, in the component that manages `selectedSlug`, initialize it from the URL:

```typescript
const [searchParams] = useSearchParams();
const initialSlug: string = searchParams.get('prompt') ?? promptSets[0]?.slug ?? '';
const [selectedSlug, setSelectedSlug] = useState<string>(initialSlug);
```

Also add a `useEffect` to update when `searchParams` changes (for SPA navigation):

```typescript
useEffect(() => {
  const paramSlug: string | null = searchParams.get('prompt');
  if (paramSlug != null && promptSets.some((p) => p.slug === paramSlug)) {
    setSelectedSlug(paramSlug);
  }
}, [searchParams, promptSets]);
```

**Step 2: Verify the page still works without a query param**

Open `/admin/config/ai` — should default to the first prompt set as before.

**Step 3: Verify deep-linking works**

Open `/admin/config/ai?prompt=newspaper-daily-digest` — should select the Daily Digest prompt.

**Step 4: Commit**

```bash
git add packages/web/src/admin/AiSettings.tsx
git commit -m "feat(admin): add deep-link support to AI Settings prompt editor"
```

---

## Task 5: Add "Generate for Date" UI to EditionBrowser (Frontend)

Add a date picker and "Generate" button at the top of the Edition Manager page.

**Files:**
- Modify: `packages/web/src/admin/newspaper/EditionBrowser.tsx`

**Step 1: Add the generate-for-date form**

Add state and handler:

```typescript
const [generateDate, setGenerateDate] = useState<string>('');
const [generating, setGenerating] = useState<boolean>(false);

const handleGenerate = useCallback(async () => {
  if (!generateDate) return;
  setGenerating(true);
  setError(null);
  try {
    await apiFetch(`/api/admin/newspaper/generate/${generateDate}`, {
      method: 'POST',
    });
    await fetchEditions();
  } catch (error_) {
    setError(error_ instanceof Error ? error_.message : 'Generation failed');
  } finally {
    setGenerating(false);
  }
}, [generateDate, fetchEditions]);
```

Add the UI between the header and the table:

```tsx
<div className="flex items-end gap-3">
  <div>
    <label className="mb-1 block text-sm font-medium text-on-surface" htmlFor="generate-date">
      Generate Edition
    </label>
    <input
      className="rounded-theme border border-border-theme bg-surface px-3 py-1.5 text-sm text-on-surface"
      id="generate-date"
      onChange={(e) => setGenerateDate(e.target.value)}
      type="date"
      value={generateDate}
    />
  </div>
  <Button
    disabled={!generateDate || generating}
    onClick={() => void handleGenerate()}
  >
    {generating ? 'Generating...' : 'Generate'}
  </Button>
</div>
```

**Step 2: Add a "Regenerate" action button to the existing edition rows**

In the actions column of the table, add a Regenerate button alongside the existing Publish/Delete/View actions. Use a confirmation Dialog (same pattern as delete):

```tsx
<RegenerateEditionDialog
  date={edition.editionDate}
  disabled={isBusy}
  onConfirm={() => void handleRegenerate(edition.editionDate)}
/>
```

Add the handler:

```typescript
const handleRegenerate = useCallback(
  async (date: string) => {
    setActing(date);
    try {
      await apiFetch(`/api/admin/newspaper/regenerate/${date}`, {
        method: 'POST',
      });
      await fetchEditions();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Regeneration failed');
    } finally {
      setActing(null);
    }
  },
  [fetchEditions],
);
```

Add the `RegenerateEditionDialog` component (follow the same pattern as `DeleteEditionDialog`):

```tsx
type RegenerateEditionDialogProps = {
  date: string;
  disabled: boolean;
  onConfirm: () => void;
};

function RegenerateEditionDialog({ date, disabled, onConfirm }: RegenerateEditionDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled} size="sm" variant="outline">
          Regenerate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate edition {date}?</DialogTitle>
          <DialogDescription>
            This will delete the existing edition and all its articles, then regenerate everything
            from scratch. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm} variant="destructive">
              Regenerate
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Verify in browser**

- The date picker and Generate button should appear above the editions table
- Picking a date and clicking Generate should trigger generation (you'll see the edition appear in the table)
- The Regenerate button should appear in the actions column of each existing edition

**Step 4: Commit**

```bash
git add packages/web/src/admin/newspaper/EditionBrowser.tsx
git commit -m "feat(admin): add generate-for-date and regenerate buttons to Edition Manager"
```

---

## Task 6: Enhance EditionDetail with Content Slot Cards (Frontend)

Redesign the EditionDetail page to show ALL expected content slots for the edition's date, including missing ones (with a Generate button). Each card links to the AI Settings prompt editor for that content type.

**Files:**
- Modify: `packages/web/src/admin/newspaper/EditionDetail.tsx`

**Step 1: Fetch the slots manifest alongside the edition**

Add a new fetch for the slots manifest:

```typescript
type SlotManifestEntry = {
  contentType: string;
  slug: string;
  displayOrder: number;
  promptSlug: string | null;
  slotGroup: 'daily' | 'slotA' | 'slotB' | 'slotC';
};

const [slots, setSlots] = useState<Array<SlotManifestEntry>>([]);

// In fetchEdition callback, also fetch slots:
const slotsData: Array<SlotManifestEntry> = await apiFetch(
  `/api/newspaper/edition/${date}/slots`,
);
setSlots(slotsData);
```

**Step 2: Merge slots with existing articles**

After fetching both the edition (with articles) and the slots manifest, merge them so each slot has either an existing article or a "missing" placeholder:

```typescript
type MergedSlot = {
  manifest: SlotManifestEntry;
  article: Article | null;
};

const mergedSlots: MergedSlot[] = useMemo(() => {
  if (slots.length === 0) return [];
  return slots
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((manifest) => ({
      manifest,
      article: edition?.articles.find((a) => a.slug === manifest.slug) ?? null,
    }));
}, [slots, edition]);
```

**Step 3: Update the rendering to use merged slots**

Replace the current `edition.articles.sort(...).map(...)` rendering loop with the merged slots:

```tsx
<div className="space-y-4">
  {mergedSlots.map((slot) => (
    <SlotCard
      key={slot.manifest.slug}
      slot={slot}
      editionDate={edition.editionDate}
      onRegenerate={handleRegenerate}
      onGenerate={handleGenerateSlot}
      onUpdate={fetchEdition}
      regenerating={regenerating === slot.manifest.slug}
      generating={generatingSlot === slot.manifest.slug}
    />
  ))}
</div>
```

**Step 4: Add the `handleGenerateSlot` handler**

```typescript
const [generatingSlot, setGeneratingSlot] = useState<string | null>(null);

const handleGenerateSlot = useCallback(
  async (slug: string) => {
    if (!date) return;
    setGeneratingSlot(slug);
    try {
      await apiFetch(`/api/admin/newspaper/generate/${date}/${slug}`, {
        method: 'POST',
      });
      await fetchEdition();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Failed to generate');
    } finally {
      setGeneratingSlot(null);
    }
  },
  [date, fetchEdition],
);
```

**Step 5: Create the `SlotCard` component**

Replace `ArticleCard` usage with a new `SlotCard` that handles both existing articles and missing slots:

```tsx
type SlotCardProps = {
  slot: MergedSlot;
  editionDate: string;
  onRegenerate: (slug: string) => Promise<void>;
  onGenerate: (slug: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  regenerating: boolean;
  generating: boolean;
};

function SlotCard({
  slot,
  editionDate,
  onRegenerate,
  onGenerate,
  onUpdate,
  regenerating,
  generating,
}: SlotCardProps) {
  const { manifest, article } = slot;

  // Slot group label
  const groupLabels: Record<string, string> = {
    daily: 'Daily',
    slotA: 'Slot A',
    slotB: 'Slot B',
    slotC: 'Slot C',
  };

  if (article == null) {
    // Missing slot — show placeholder with Generate button
    return (
      <div className="rounded-theme border border-dashed border-border-theme bg-surface/50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-on-surface-muted">{manifest.slug}</h3>
            <div className="mt-1 flex items-center gap-2 text-xs text-on-surface-muted">
              <Badge variant="secondary">{groupLabels[manifest.slotGroup]}</Badge>
              <span className="font-mono">{manifest.contentType}</span>
              <Badge variant="secondary">Not generated</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {manifest.promptSlug != null && (
              <Link
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                to={`/admin/config/ai?prompt=${manifest.promptSlug}`}
              >
                Edit Prompt
              </Link>
            )}
            <Button
              disabled={generating}
              onClick={() => void onGenerate(manifest.slug)}
              size="sm"
            >
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Existing article — enhanced version of the original ArticleCard
  // (keep existing edit/regenerate/source-data functionality, add prompt link)
  return (
    <ArticleCard
      article={article}
      editionDate={editionDate}
      onRegenerate={onRegenerate}
      onUpdate={onUpdate}
      promptSlug={manifest.promptSlug}
      regenerating={regenerating}
      slotGroup={groupLabels[manifest.slotGroup]}
    />
  );
}
```

**Step 6: Update `ArticleCard` to accept and render the prompt link**

Add `promptSlug` and `slotGroup` to `ArticleCardProps`:

```typescript
type ArticleCardProps = {
  article: Article;
  editionDate: string;
  onRegenerate: (slug: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  promptSlug: string | null;
  regenerating: boolean;
  slotGroup: string;
};
```

In the card's metadata row (next to the slug and "by model" text), add:
- The slot group badge
- A link to the prompt settings (if `promptSlug` is not null):

```tsx
{promptSlug != null && (
  <Link
    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
    to={`/admin/config/ai?prompt=${promptSlug}`}
  >
    Edit Prompt
  </Link>
)}
```

And in the metadata area, add the slot group:

```tsx
<Badge variant="secondary">{slotGroup}</Badge>
```

**Step 7: Verify in browser**

Navigate to an edition that exists (e.g., `/admin/maintain/newspaper/2026-03-28`):
- All 8 expected content slots should appear (5 daily + 3 rotation)
- Already-generated articles show the full card with edit/regenerate
- Missing articles show a dashed-border placeholder with "Generate" button
- Each card (except image types) shows an "Edit Prompt" link
- Clicking "Edit Prompt" navigates to `/admin/config/ai?prompt=newspaper-daily-digest` (etc.)

Navigate to a date with no edition yet:
- The page should handle the 404 gracefully — currently it shows "Edition not found." Consider whether to show the slot manifest anyway with all Generate buttons. (If so, adjust to still fetch slots even when edition is null, and show all slots as missing.)

**Step 8: Commit**

```bash
git add packages/web/src/admin/newspaper/EditionDetail.tsx
git commit -m "feat(admin): show all content slots on edition detail with generate + prompt links"
```

---

## Task 7: Handle "No Edition Yet" State in EditionDetail

When navigating to `/admin/maintain/newspaper/2026-04-01` for a date with no edition, the page should still show the slot manifest with all Generate buttons (instead of "Edition not found").

**Files:**
- Modify: `packages/web/src/admin/newspaper/EditionDetail.tsx`

**Step 1: Fetch slots even when edition doesn't exist**

Change `fetchEdition` to handle 404 gracefully:

```typescript
const fetchEdition = useCallback(async () => {
  if (!date) return;
  try {
    // Always fetch the slot manifest
    const slotsData: Array<SlotManifestEntry> = await apiFetch(
      `/api/newspaper/edition/${date}/slots`,
    );
    setSlots(slotsData);

    // Try to fetch the edition (may not exist yet)
    try {
      const data: EditionWithArticles = await apiFetch(`/api/newspaper/edition/${date}`);
      setEdition(data);
    } catch {
      // Edition doesn't exist yet — that's fine, slots will show as all-missing
      setEdition(null);
    }
  } catch (error_) {
    setError(error_ instanceof Error ? error_.message : 'Failed to load');
  } finally {
    setLoading(false);
  }
}, [date]);
```

**Step 2: Update rendering for null edition**

When `edition` is null but `slots` is populated, show:
- The date header (from the route param)
- A status indicator saying "No edition — generate to create"
- All slot cards as missing (each with Generate button)
- A "Generate All" button in the header

```tsx
if (!edition && slots.length > 0) {
  // Show slot manifest with all-missing state
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link className="text-sm text-on-surface-muted hover:text-on-surface" to="/admin/maintain/newspaper">
          &larr; All Editions
        </Link>
        <Button
          disabled={generatingAll}
          onClick={() => void handleGenerateAll()}
        >
          {generatingAll ? 'Generating...' : 'Generate All'}
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">{date}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          No edition exists yet. Generate individual slots or all at once.
        </p>
      </div>
      <div className="space-y-4">
        {slots.sort((a, b) => a.displayOrder - b.displayOrder).map((manifest) => (
          <SlotCard
            key={manifest.slug}
            slot={{ manifest, article: null }}
            editionDate={date!}
            onRegenerate={handleRegenerate}
            onGenerate={handleGenerateSlot}
            onUpdate={fetchEdition}
            regenerating={false}
            generating={generatingSlot === manifest.slug}
          />
        ))}
      </div>
    </div>
  );
}
```

Add `handleGenerateAll`:

```typescript
const [generatingAll, setGeneratingAll] = useState<boolean>(false);

const handleGenerateAll = useCallback(async () => {
  if (!date) return;
  setGeneratingAll(true);
  try {
    await apiFetch(`/api/admin/newspaper/generate/${date}`, { method: 'POST' });
    await fetchEdition();
  } catch (error_) {
    setError(error_ instanceof Error ? error_.message : 'Generation failed');
  } finally {
    setGeneratingAll(false);
  }
}, [date, fetchEdition]);
```

**Step 3: Verify in browser**

Navigate to `/admin/maintain/newspaper/2026-04-01` (a future date with no edition):
- Should show the date header, "No edition exists yet" message
- All expected slots shown as missing with Generate buttons
- "Generate All" button in the header triggers full generation

**Step 4: Commit**

```bash
git add packages/web/src/admin/newspaper/EditionDetail.tsx
git commit -m "feat(admin): handle no-edition state with slot manifest and generate buttons"
```

---

## Task 8: Display Name Mapping for Slot Cards

The slot cards currently show slugs (e.g., `three-miles-up`). They should show human-readable display names. The frontend already has `DISPLAY_NAME_MAP` in `packages/web/src/newspaper/types.ts`.

**Files:**
- Modify: `packages/web/src/admin/newspaper/EditionDetail.tsx`

**Step 1: Import display name map**

Check `packages/web/src/newspaper/types.ts` for the `DISPLAY_NAME_MAP` and import it:

```typescript
import { DISPLAY_NAME_MAP } from '../../newspaper/types.ts';
```

**Step 2: Use display names in SlotCard**

In both the missing and existing article card renderings, use:

```typescript
const displayName: string = DISPLAY_NAME_MAP[manifest.contentType] ?? manifest.slug;
```

Show this as the card title instead of the raw slug.

**Step 3: Verify display names render correctly**

Check that cards show "300 Miles Up" instead of "three-miles-up", etc.

**Step 4: Commit**

```bash
git add packages/web/src/admin/newspaper/EditionDetail.tsx
git commit -m "feat(admin): use human-readable display names for content slot cards"
```

---

## Task 9: Integration Testing

**Step 1: Test the full flow end-to-end in browser**

1. Go to `/admin/maintain/newspaper`
2. Pick a date using the date picker, click Generate
3. Watch the edition appear in the table
4. Click into the edition detail page
5. Verify all slots are shown (generated ones with content, missing ones with Generate)
6. Click Generate on a missing slot
7. Click "Edit Prompt" link — verify it deep-links to the correct prompt in AI Settings
8. Go back to the edition list, click Regenerate on the edition
9. Verify it re-creates from scratch

**Step 2: Test the no-edition state**

1. Navigate directly to `/admin/maintain/newspaper/2026-12-25` (a date with no edition)
2. Verify the slot manifest shows (it's a Thursday: daily types + `competitive_intel` + `tech_spotlight` + `market_signals`)
3. Click Generate All
4. Verify all articles generate and the page updates

**Step 3: Test edge cases**

- Weekend date: should show only 5 daily types (no rotation slots)
- Already-complete edition: Generate should skip existing articles (idempotent)
- Generate a single slot on an edition that doesn't exist yet: should create the edition

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(admin): complete edition manager enhancements with date generation and slot visibility"
```

---

## Architecture Decisions Summary

1. **HTML5 `<input type="date">`** over a third-party date picker — keeps dependencies minimal and matches the existing form input styling. The native picker is fully functional for YYYY-MM-DD selection.

2. **Server-side generation via API** rather than shelling out to the CLI — the running server already has `ConfigService`, `InferenceService`, and DB connections initialized. Creating a service function that reuses this infrastructure is cleaner and faster than spawning a CLI subprocess.

3. **Slots manifest as a separate endpoint** rather than embedding slot info in the edition response — the manifest is computable from the date alone (no DB needed), so it works even when no edition exists. Keeping it separate avoids changing the existing edition response shape.

4. **Deep-linking to AI Settings via query params** rather than adding per-content-type settings pages — there's already a unified prompt editor. A simple `?prompt=<slug>` param is the minimal change that enables direct navigation.

5. **Regenerate = delete + generate** rather than resetting individual articles — simpler, matches the user's mental model ("start fresh"), and the generation pipeline is already idempotent.
