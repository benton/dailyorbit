# Hidden Items Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to hide individual Filings or News Items from their own view, and allow admins to hide items system-wide (e.g., bad data with erroneous future dates).

**Architecture:** Two-tier visibility system using a single `hidden_item` table with a `scope` discriminator. User-scoped hides are personal; admin-scoped hides apply globally. Search and list queries filter out hidden items by default, with an opt-in toggle to reveal them. The pattern closely follows the existing `content-flag` module (schema + repository + routes + types).

**Tech Stack:** DuckDB, Hono, React (TanStack Table), existing pagination/search infrastructure.

---

## Design Decisions

### D1: Single table vs. two tables
**Decision:** Single `hidden_item` table with `scope` column (`'user'` or `'system'`).
- User hides: `scope = 'user'`, `user_id` = the hiding user
- Admin hides: `scope = 'system'`, `user_id` = the admin who performed the action
- Simpler queries (one LEFT JOIN covers both), no duplication

### D2: content_type values
Reuse the same `content_type` vocabulary as content-flag: `'filing'` and `'news'`.
- `content_key` = `file_number` for filings, `String(news_item.id)` for news items

### D3: How queries exclude hidden items
Search and list queries accept an optional `userId` parameter. When provided, add:
```sql
AND NOT EXISTS (
  SELECT 1 FROM hidden_item h
  WHERE h.content_type = '<type>'
    AND h.content_key = <key_column>
    AND h.removed_at IS NULL
    AND (h.scope = 'system' OR (h.scope = 'user' AND h.user_id = $userId))
)
```
When the `showHidden` flag is set, skip this clause.

### D4: "Unhide all" is per-user only
The User prefs "Unhide all" button soft-deletes only the current user's `scope = 'user'` rows. System-wide hides can only be removed by an admin.

### D5: Admin hide/unhide
Admin routes at `/api/admin/hidden-items` manage `scope = 'system'` rows. The admin UI surfaces a list of system-hidden items with an unhide action.

---

## Task 1: Schema — `hidden_item` table

**Files:**
- Create: `packages/server/src/hidden-item/schema.ts`

**Step 1: Write the schema module**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureHiddenItemTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS hidden_item_id_seq START 1;
    CREATE TABLE IF NOT EXISTS hidden_item (
      id            INTEGER NOT NULL DEFAULT nextval('hidden_item_id_seq') PRIMARY KEY,
      user_id       VARCHAR NOT NULL,
      content_type  VARCHAR NOT NULL,
      content_key   VARCHAR NOT NULL,
      scope         VARCHAR NOT NULL DEFAULT 'user',
      reason        VARCHAR,
      created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
      removed_at    TIMESTAMP,
      UNIQUE (user_id, content_type, content_key, scope)
    );
  `);
}
```

Follows `content-flag/schema.ts` pattern exactly. `scope` is `'user'` or `'system'`. `removed_at` is the soft-delete timestamp (like `dismissed_at` in content-flag).

**Step 2: Commit**
```
feat(hidden-items): add hidden_item table schema
```

---

## Task 2: Types

**Files:**
- Create: `packages/server/src/hidden-item/types.ts`

**Step 1: Write the types module**

```typescript
export type HiddenItemScope = 'user' | 'system';

export type HiddenItemRow = {
  id: number;
  user_id: string;
  content_type: string;
  content_key: string;
  scope: HiddenItemScope;
  reason: string | null;
  created_at: string;
  removed_at: string | null;
};

export type HideItemInput = {
  content_type: string;
  content_key: string;
  reason?: string;
};

export type BulkHideInput = {
  content_type: string;
  content_keys: string[];
  reason?: string;
};
```

**Step 2: Commit**
```
feat(hidden-items): add hidden-item types
```

---

## Task 3: Repository — core CRUD

**Files:**
- Create: `packages/server/src/hidden-item/repository.ts`
- Test: `packages/server/src/hidden-item/repository.test.ts`

**Step 1: Write failing tests**

Test cases (parameterized where possible):

| Test | Description |
|------|-------------|
| `hideItem upserts and returns id` | Insert, read back, verify fields |
| `hideItem re-activates a removed hide` | Hide, unhide, re-hide — `removed_at` should be null |
| `unhideItem soft-deletes` | Hide, unhide — verify `removed_at` is set |
| `unhideItem returns false for non-existent` | Unhide an id that doesn't exist |
| `getActiveHiddenKeys returns correct set` | Hide 3 items, unhide 1, bulk-check returns the 2 active |
| `getActiveHidesForUser returns only active user-scope hides` | Mix of user/system hides, only user's returned |
| `unhideAllForUser removes only user-scope hides` | User has 2 hides + 1 system hide; unhideAll clears only user's 2 |
| `getSystemHides returns only system-scope hides` | Mix of user/system; only system returned |

Use in-memory DuckDB (`:memory:`) per **D-3** in AGENTS.md.

**Step 2: Run tests, verify they fail**

```bash
make test -- --testPathPattern hidden-item
```

**Step 3: Implement repository functions**

```typescript
// hideItem(conn, userId, input, scope) → number
// unhideItem(conn, id, userId) → boolean
// unhideAllForUser(conn, userId) → number (count removed)
// getActiveHiddenKeys(conn, userId, contentType, contentKeys) → Set<string>
//   — returns keys hidden for this user OR system-wide
// getActiveHidesForUser(conn, userId, contentType) → HiddenItemRow[]
//   — returns only scope='user' hides for this user
// getSystemHides(conn, contentType) → HiddenItemRow[]
//   — returns only scope='system' hides (admin view)
// unhideSystemItem(conn, id) → boolean
//   — admin unhide (sets removed_at on a system-scope row)
```

Key query for `getActiveHiddenKeys` (used by search exclusion and bulk-check):
```sql
SELECT content_key FROM hidden_item
WHERE content_type = $1
  AND removed_at IS NULL
  AND content_key IN (...)
  AND (scope = 'system' OR (scope = 'user' AND user_id = $2))
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**
```
feat(hidden-items): add hidden-item repository with tests
```

---

## Task 4: User API routes

**Files:**
- Create: `packages/server/src/hidden-item/routes.ts`
- Modify: `packages/server/src/app.ts` (add route mounting)

**Step 1: Write the routes module**

Follow `content-flag/routes.ts` pattern:

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | `/api/user/hidden-items?content_type=filing` | List active user-scope hides |
| `POST /` | `/api/user/hidden-items` | Hide a single item (scope=user) |
| `POST /bulk-check` | `/api/user/hidden-items/bulk-check` | Check which keys are hidden (user OR system) |
| `POST /:id/unhide` | `/api/user/hidden-items/:id/unhide` | Unhide a single item |
| `POST /unhide-all` | `/api/user/hidden-items/unhide-all` | Unhide all user-scope hides |

**Step 2: Mount in app.ts**

```typescript
import { hiddenItemRoutes } from './hidden-item/routes.ts';
// ...
app.route('/api/user/hidden-items', hiddenItemRoutes);
```

**Step 3: Commit**
```
feat(hidden-items): add user hidden-items API routes
```

---

## Task 5: Admin API routes

**Files:**
- Create: `packages/server/src/hidden-item/admin-routes.ts`
- Modify: `packages/server/src/app.ts` (add admin route mounting)

**Step 1: Write the admin routes module**

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | `/api/admin/hidden-items?content_type=filing` | List system-scope hides |
| `POST /` | `/api/admin/hidden-items` | Hide item system-wide (scope=system) |
| `POST /:id/unhide` | `/api/admin/hidden-items/:id/unhide` | Remove a system-wide hide |

Admin routes use `scope = 'system'` and store the admin's `user_id` as the actor.

**Step 2: Mount in app.ts**

```typescript
import { hiddenItemAdminRoutes } from './hidden-item/admin-routes.ts';
// ...
app.route('/api/admin/hidden-items', hiddenItemAdminRoutes);
```

**Step 3: Commit**
```
feat(hidden-items): add admin hidden-items API routes
```

---

## Task 6: Integrate hiding into search queries

**Files:**
- Modify: `packages/server/src/search/repository.ts` — `searchFilings()`
- Modify: `packages/server/src/search/news-search.ts` — `searchNewsByKeyword()`
- Modify: `packages/server/src/search/types.ts` — add `show_hidden` to filter types
- Modify: `packages/server/src/search/routes.ts` — pass `userId` and `show_hidden` through

**Step 1: Write failing integration tests**

Test that:
1. A user-hidden filing does NOT appear in search results (default)
2. A system-hidden filing does NOT appear in search results (default)
3. When `show_hidden=true`, hidden items DO appear in results
4. Same three cases for news search

**Step 2: Run tests, verify they fail**

**Step 3: Modify `searchFilings`**

Add optional params: `userId?: string`, `showHidden?: boolean`. When `!showHidden` and `userId` is provided, add the NOT EXISTS clause from **D3** to the conditions array.

Similarly modify the news search function.

**Step 4: Modify search routes**

Read `show_hidden` query param (default false). Pass `user.id` from session (may be undefined for public routes — in which case only system hides apply; adjust the NOT EXISTS to `scope = 'system'` only).

**Step 5: Run tests, verify they pass**

**Step 6: Commit**
```
feat(hidden-items): exclude hidden items from search results
```

---

## Task 7: Integrate hiding into list queries

**Files:**
- Modify: Any filing list / news list queries that power the dashboard, "recent filings", "recent news", etc.
- Check: `packages/server/src/filings/routes.ts`, `packages/server/src/news/routes.ts`

Same NOT EXISTS pattern as Task 6. This ensures hidden items don't appear in dashboard feeds either.

**Step 1: Identify all filing/news list endpoints that should respect hiding**

Grep for `SELECT` queries on `filing` and `news_item` tables across routes and repositories.

**Step 2: Add the NOT EXISTS exclusion to each, gated by the same `showHidden` flag**

**Step 3: Write integration tests for at least the main list endpoints**

**Step 4: Commit**
```
feat(hidden-items): exclude hidden items from list endpoints
```

---

## Task 8: Frontend — Hide button on Filing and News items

**Files:**
- Modify: Filing list/detail components — add "Hide" action
- Modify: News list/detail components — add "Hide" action
- Create: `packages/web/src/lib/hidden-items.ts` — API client helpers

**Step 1: Create the API client helpers**

```typescript
export async function hideItem(contentType: string, contentKey: string, reason?: string): Promise<void>
export async function unhideItem(id: number): Promise<void>
export async function bulkCheckHidden(contentType: string, keys: string[]): Promise<Set<string>>
export async function unhideAll(): Promise<void>
```

**Step 2: Add hide/unhide toggle to list tables**

Follow the existing `flagCol` pattern from content-flag integration:
- Bulk-check hidden status when list loads
- Toggle button per row
- Visually dim or strike-through hidden items when `showHidden` is on

**Step 3: Commit**
```
feat(hidden-items): add hide/unhide UI for filings and news items
```

---

## Task 9: Frontend — Search "Show hidden items" toggle

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx` (or equivalent search UI)

**Step 1: Add a checkbox/toggle labeled "Show hidden items"**

When checked, pass `show_hidden=true` query param to the search API. Default: unchecked.

**Step 2: When toggled on, hidden items should appear with a visual indicator** (e.g., muted background, "Hidden" badge)

**Step 3: Commit**
```
feat(hidden-items): add show-hidden toggle to search UI
```

---

## Task 10: Frontend — User Preferences "Unhide All" button

**Files:**
- Modify: User preferences/settings page component

**Step 1: Add an "Unhide All" button to the user preferences page**

Calls `POST /api/user/hidden-items/unhide-all`. Show confirmation dialog before executing. Display success toast with count of items unhidden.

**Step 2: Commit**
```
feat(hidden-items): add unhide-all button to user preferences
```

---

## Task 11: Frontend — Admin Hidden Items management

**Files:**
- Create or modify: Admin UI page for managing system-wide hidden items

**Step 1: Add an admin page listing system-hidden items**

Table with columns: content type, content key (linked to the filing/news item), reason, hidden by, hidden at. Each row has an "Unhide" action.

**Step 2: Add "Hide system-wide" action to admin filing/news views**

Admin users see an additional "Hide for all users" option alongside the personal "Hide" button.

**Step 3: Commit**
```
feat(hidden-items): add admin hidden-items management UI
```

---

## Summary

| Task | What | Depends on |
|------|------|-----------|
| 1 | Schema | — |
| 2 | Types | — |
| 3 | Repository + tests | 1, 2 |
| 4 | User API routes | 3 |
| 5 | Admin API routes | 3 |
| 6 | Search query integration | 3 |
| 7 | List query integration | 3 |
| 8 | Frontend hide/unhide | 4 |
| 9 | Frontend search toggle | 6, 8 |
| 10 | Frontend unhide-all | 4, 8 |
| 11 | Admin UI | 5 |

Tasks 4, 5, 6, 7 can be parallelized once Task 3 is done.
Tasks 8-11 (frontend) can be parallelized once their backend deps are done.
