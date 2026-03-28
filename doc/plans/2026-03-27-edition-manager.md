# Edition Manager — The Publisher's Interface

## Overview

Transform the admin newspaper UI from a simple browser into a full Edition Manager,
and make the public home page (`/`) serve the latest published newspaper edition.

### Design Decisions

- **Auto-publish with override**: Editions publish automatically when generation
  completes. A publisher can unpublish (pull back), edit/regenerate, and republish.
- **`/` becomes the newspaper**: The user dashboard moves to `/dashboard`.
  Falls back to the previous published edition, or a branded placeholder if none exist.
- **Inline article editing**: Publishers can edit headline + body markdown directly
  in the admin UI without a separate CMS.
- **Hard delete with confirmation**: No soft deletes — editions can be regenerated.
  Two-step confirmation in UI prevents accidents.
- **Edition-level publish only**: No per-article publish/unpublish toggle.

---

## Step 1: Schema Migration

Add `published_at` (TIMESTAMP, nullable) to `newspaper_edition`.

Backfill: `UPDATE newspaper_edition SET published_at = updated_at WHERE status = 'complete'`

No new tables.

### Files to modify
- `packages/server/src/newspaper/schema.ts` — add column to CREATE TABLE
- `packages/server/src/newspaper/types.ts` — add `publishedAt` to TypeScript type
- New migration or inline schema update per existing pattern

---

## Step 2: Repository + Service Layer

### New repository methods
- `publishEdition(date)` — `SET published_at = NOW() WHERE edition_date = ? AND status = 'complete'`
- `unpublishEdition(date)` — `SET published_at = NULL WHERE edition_date = ?`
- `deleteEdition(date)` — Delete articles, then edition. Return image paths for cleanup.
- `updateArticle(editionDate, slug, { headline?, body? })` — Partial update of non-null fields.
- Modify `getLatestEdition()` — add `WHERE published_at IS NOT NULL` filter.

### New service methods
- `publishEdition(date)` — calls repo, returns 409 if not complete
- `unpublishEdition(date)` — calls repo
- `deleteEdition(date)` — calls repo, deletes image directory from storage
- `updateArticle(date, slug, patch)` — calls repo

### Files to modify
- `packages/server/src/newspaper/repository.ts`
- New or existing service file in `packages/server/src/newspaper/`

---

## Step 3: API Routes

### New admin endpoints (`/api/admin/newspaper/`)
- `POST /edition/:date/publish` — 200 on success, 409 if not complete
- `POST /edition/:date/unpublish` — 200 on success
- `DELETE /edition/:date` — 200 on success, 404 if not found
- `PUT /edition/:date/article/:slug` — accepts `{ headline?, body? }`, returns updated article

### Modified endpoints
- `GET /api/newspaper/edition/latest` — filter on `published_at IS NOT NULL`
- `GET /api/newspaper/editions` — include `publishedAt` in response
- `GET /api/newspaper/edition/:date` (public route) — return 404 if not published

### Files to modify
- `packages/server/src/newspaper/routes.ts`

---

## Step 4: Pipeline Integration

Update the `generate` CLI command: when it sets `status = 'complete'` on an edition,
also set `published_at = NOW()`.

### Files to modify
- `packages/server/src/cli/newspaper/index.ts`

---

## Step 5: Admin UI — Edition Manager

### Edition list (`EditionBrowser.tsx`)
- Add **Published** column — green/empty dot, `published_at` on hover
- Add **Actions** column — Publish/Unpublish toggle, Delete button
- Delete opens confirmation dialog with article count and warning

### Edition detail (`EditionDetail.tsx`)
- Top bar: **Publish/Unpublish** button (primary), **Delete** button (destructive)
- Article cards gain **Edit** button:
  - Inline edit mode: headline as text input, body as textarea (markdown)
  - Save / Cancel buttons
  - "Edited" badge when article was manually modified
- Existing Regenerate button unchanged

### New shared components
- Confirmation dialog (may already exist in UI library)

### Files to modify
- `packages/web/src/admin/newspaper/EditionBrowser.tsx`
- `packages/web/src/admin/newspaper/EditionDetail.tsx`
- API client hooks (new mutations for publish/unpublish/delete/update)

---

## Step 6: Public Home Page

### Route changes
- `/` — serves latest published edition via `NewspaperView`
- `/dashboard` — new route for the existing user dashboard
- `/newspaper/:date` — existing route, add published-only guard for non-admin users

### Placeholder component
When no published edition exists: masthead with today's date, Daily Orbit logo,
"Today's edition is being prepared." Broadsheet-consistent styling.

### Navigation updates
- Admin sidebar gets "Dashboard" link to `/dashboard`
- Breadcrumb at `/` shows "Daily Orbit"

### Files to modify
- `packages/web/src/App.tsx` (or router config) — route changes
- `packages/web/src/newspaper/NewspaperView.tsx` — fallback/placeholder
- Dashboard component — update route
- Navigation/sidebar components — add dashboard link
