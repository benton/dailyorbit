# Newspaper Session 6: Admin UI — Settings & Edition Browser

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add newspaper-specific admin UI: AI Settings section for model/prompt configuration, and an Edition Browser for reviewing and regenerating generated content. The pipeline control UI is already handled automatically by the existing PipelinePage (no work needed).

**Prereqs:** Session 1 complete (API routes, config keys). Other sessions provide more content to browse but are not required.

**Key insight:** The pipeline page (`packages/web/src/admin/pipeline/PipelinePage.tsx`) dynamically renders all `PIPELINE_GROUPS` — adding the newspaper group in Session 1 means it **automatically appears** in the pipeline UI. No frontend work needed for run/stop/status.

---

## Task 1: Add Newspaper Section to AI Settings

**Files:**
- Modify: `packages/web/src/admin/AiSettings.tsx`

Follow the existing pattern used for "Summarization Prompts" and "News Summarization Prompts" sections. Add a "Newspaper" section with two sub-sections.

**Step 1: Add state variables** (follow `summSystemPrompt`/`summUserPrompt` pattern):

```typescript
// Newspaper copy generation
const [newspaperCopySystemPrompt, setNewspaperCopySystemPrompt] = useState<string>('');
const [newspaperCopyUserPrompt, setNewspaperCopyUserPrompt] = useState<string>('');

// Newspaper editorial (override)
const [newspaperEditorialSystemPrompt, setNewspaperEditorialSystemPrompt] = useState<string>('');
const [newspaperEditorialUserPrompt, setNewspaperEditorialUserPrompt] = useState<string>('');
```

**Step 2: Fetch config values** in the existing `useEffect` that loads config:

```typescript
setNewspaperCopySystemPrompt(configMap.newspaperCopySystemPrompt ?? '');
setNewspaperCopyUserPrompt(configMap.newspaperCopyUserPrompt ?? '');
setNewspaperEditorialSystemPrompt(configMap.newspaperEditorialSystemPrompt ?? '');
setNewspaperEditorialUserPrompt(configMap.newspaperEditorialUserPrompt ?? '');
```

**Step 3: Add model selection** — a dropdown or radio group for `newspaperCopyModel` and `newspaperImageModel`, following the existing summarization model selector pattern.

**Step 4: Add PromptEditor components:**

```tsx
<h2>Newspaper</h2>

<h3>Copy Generation Model</h3>
{/* Model dropdown reading/writing newspaperCopyModel config key */}

<h3>Image Generation Model</h3>
{/* Model dropdown reading/writing newspaperImageModel config key */}

<PromptEditor
  title="Daily Digest & General Copy Prompts"
  description="Prompts used for the '3 Miles Up' daily digest, fake ads, company spotlights, and other text content."
  defaultSystemPrompt={DEFAULT_DIGEST_SYSTEM_PROMPT}
  defaultUserPrompt={DEFAULT_DIGEST_USER_PROMPT}
  systemPrompt={newspaperCopySystemPrompt}
  userPrompt={newspaperCopyUserPrompt}
  onSystemPromptChange={(v) => { setNewspaperCopySystemPrompt(v); saveConfig('newspaperCopySystemPrompt', v); }}
  onUserPromptChange={(v) => { setNewspaperCopyUserPrompt(v); saveConfig('newspaperCopyUserPrompt', v); }}
  variables={NEWSPAPER_COPY_VARIABLES}
/>

<PromptEditor
  title="Editorial Prompts (Override)"
  description="Optional override for the 'Over the Horizon' editorial. Uses persona rotation. Blank = uses default."
  defaultSystemPrompt={''}
  defaultUserPrompt={''}
  systemPrompt={newspaperEditorialSystemPrompt}
  userPrompt={newspaperEditorialUserPrompt}
  onSystemPromptChange={(v) => { setNewspaperEditorialSystemPrompt(v); saveConfig('newspaperEditorialSystemPrompt', v); }}
  onUserPromptChange={(v) => { setNewspaperEditorialUserPrompt(v); saveConfig('newspaperEditorialUserPrompt', v); }}
  variables={EDITORIAL_VARIABLES}
/>
```

Import the default prompts and variable catalogs from shared types or define them inline (the frontend can fetch template metadata from `/api/admin/inference/prompt-templates` if the backend exposes it).

---

## Task 2: Expose Newspaper Prompt Templates via API

**Files:**
- Modify: `packages/server/src/inference/routes.ts` (or `packages/server/src/newspaper/routes.ts`)

Add newspaper prompt template metadata to the existing `/api/admin/inference/prompt-templates` endpoint, or create a newspaper-specific endpoint. The frontend needs:
- Default system/user prompts for each content type
- Template variable catalogs (name, description, example)

Follow the existing `PromptTemplateMeta` pattern.

---

## Task 3: Create Edition Browser Page

**Files:**
- New: `packages/web/src/admin/newspaper/EditionBrowser.tsx`
- New: `packages/web/src/admin/newspaper/EditionDetail.tsx`

**EditionBrowser.tsx** — list view:

```tsx
// Route: /admin/newspaper
// Fetches: GET /api/newspaper/editions?limit=20&offset=0
// Displays: Table with columns: Date, Status, Article Count, Generation Time
// Actions: Click row → navigate to /admin/newspaper/:date
```

Use `@tanstack/react-table` for the table (already used elsewhere in admin).

| Column | Source | Notes |
|--------|--------|-------|
| Date | `edition_date` | Formatted as display date |
| Type | `edition_type` | 'daily' or 'weekly' |
| Status | `status` | Badge: pending/generating/complete/failed |
| Articles | count of articles | From joined data or separate query |
| Generated | `created_at` | Relative time ("2 hours ago") |

**EditionDetail.tsx** — detail view:

```tsx
// Route: /admin/newspaper/:date
// Fetches: GET /api/newspaper/edition/:date
// Displays: All articles for this edition, each as a card
```

Each article card shows:
- **Headline** (or content type name if no headline)
- **Status badge** (pending/generated/failed)
- **Body preview** — first 200 chars of markdown, rendered
- **Image preview** — if `image_path` is set, render inline via `/api/newspaper/images/...`
- **Source data** — expandable JSON viewer (collapsible `<details>`)
- **Regenerate button** — calls `POST /api/newspaper/edition/:date/regenerate/:slug`
- **Model info** — which model generated it (`generated_by`)

---

## Task 4: Add Regeneration API Endpoint

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

```typescript
// POST /api/newspaper/edition/:date/regenerate/:slug
// Resets the article status to 'pending', allowing the pipeline to regenerate it
// Returns: { success: true, article: NewspaperArticle }
```

This calls `resetArticle()` from the repository. The admin then runs the specific pipeline stage to regenerate.

---

## Task 5: Register Admin Route

**Files:**
- Modify: `packages/web/src/admin/AdminLayout.tsx`

Add navigation entry and route for `/admin/newspaper`:

```tsx
// In the admin sidebar/nav:
{ path: '/admin/newspaper', label: 'Newspaper', icon: NewspaperIcon }

// In the route config:
<Route path="/admin/newspaper" element={<EditionBrowser />} />
<Route path="/admin/newspaper/:date" element={<EditionDetail />} />
```

---

## Task 6: Portrait Library Manager (Optional, if Session 5 is complete)

**Files:**
- New: `packages/web/src/admin/newspaper/PortraitLibrary.tsx`

Simple grid view of all portraits from `/api/newspaper/library/portraits`:
- Thumbnail grid (4-6 per row)
- Tags displayed below each
- "Generate Library" button (calls `POST /api/newspaper/generate-library`)
- Per-portrait "Regenerate" button (future — requires backend support)

Add route: `/admin/newspaper/portraits`

---

## Verification

1. `make test` — existing tests still pass (this session is mostly frontend)
2. Navigate to `/admin/settings` → scroll to "Newspaper" section → model dropdowns and prompt editors render
3. Change `newspaperCopyModel` via dropdown → verify config saved (check DB or API)
4. Edit newspaper system prompt → verify it persists across page refresh
5. Navigate to `/admin/newspaper` → edition list loads with data
6. Click an edition → detail view shows articles with status badges and body previews
7. Click "Regenerate" on an article → status resets to 'pending'
8. Navigate to `/admin/pipeline` → "Newspaper" group appears with all registered stages
9. Run a newspaper stage from pipeline UI → verify it completes and edition browser updates
