# Viewing History Expansion & Content Flagging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend viewing history to news items, add a 10-second delayed mark-as-read on detail pages, and introduce a content flagging system that supports both manual user flags and future alert-generated flags with soft-delete dismissal.

**Architecture:** Add `user_news_view` table (parallel to existing `user_filing_view`) and `user_content_flag` table (unified across content types, with source/reason tracking and soft-delete via `dismissed_at`). Extend the existing viewing-history module with news support. Create a new `content-flag` module with its own schema, repository, routes. Frontend gets a 10-second timer on detail pages, flag toggle icons on list rows, and checkbox-based bulk flagging.

**Tech Stack:** DuckDB (existing), Hono API routes (existing), React (existing), TypeScript

**Depends on:** Saved Searches plan (for the `saved_search_id` FK on flags, but can be stubbed as nullable INTEGER without the FK constraint if built first)

---

### Task 1: Schema — `user_news_view` and `user_content_flag` tables

**Files:**
- Modify: `packages/server/src/viewing-history/schema.ts`
- Create: `packages/server/src/content-flag/schema.ts`

**Step 1: Extend viewing-history schema with `user_news_view`**

In `packages/server/src/viewing-history/schema.ts`, add a second CREATE TABLE to `ensureViewingHistoryTables`:

```typescript
await conn.run(`
  CREATE TABLE IF NOT EXISTS user_news_view (
    user_id         VARCHAR NOT NULL,
    news_item_id    INTEGER NOT NULL,
    first_viewed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    last_viewed_at  TIMESTAMP NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (user_id, news_item_id)
  )
`);
```

**Step 2: Create content-flag schema**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureContentFlagTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS content_flag_id_seq START 1;
    CREATE TABLE IF NOT EXISTS user_content_flag (
      id               INTEGER NOT NULL DEFAULT nextval('content_flag_id_seq') PRIMARY KEY,
      user_id          VARCHAR NOT NULL,
      content_type     VARCHAR NOT NULL,
      content_key      VARCHAR NOT NULL,
      source           VARCHAR NOT NULL DEFAULT 'manual',
      saved_search_id  INTEGER,
      reason           VARCHAR,
      created_at       TIMESTAMP NOT NULL DEFAULT current_timestamp,
      dismissed_at     TIMESTAMP,
      UNIQUE (user_id, content_type, content_key, saved_search_id)
    );
  `);
}
```

Note: `saved_search_id` is a plain INTEGER (no FK constraint) so this plan can be built independently of the saved-search plan. The FK can be added later via ALTER TABLE when both are merged.

**Step 3: Commit**

```bash
git add packages/server/src/viewing-history/schema.ts packages/server/src/content-flag/schema.ts
git commit -m "feat(viewing-history): add user_news_view and user_content_flag schemas"
```

---

### Task 2: News viewing history — repository and tests

**Files:**
- Modify: `packages/server/src/viewing-history/repository.ts`
- Modify: `packages/server/src/viewing-history/repository.test.ts`

**Step 1: Write failing tests for news view tracking**

Add a new describe block to the existing `repository.test.ts`:

```typescript
describe('news viewing history', () => {
  it('should mark a news item as viewed', async () => {
    await markNewsViewed(conn, testUserId, 42);
    const viewed = await getViewedNewsIds(conn, testUserId, [42, 99]);
    expect(viewed).toEqual(new Set([42]));
  });

  it('should update last_viewed_at on repeat views', async () => {
    await markNewsViewed(conn, testUserId, 42);
    // Second view
    await markNewsViewed(conn, testUserId, 42);
    const viewed = await getViewedNewsIds(conn, testUserId, [42]);
    expect(viewed).toEqual(new Set([42]));
  });

  it('should mark a news item as unread', async () => {
    await markNewsViewed(conn, testUserId, 50);
    await markNewsUnread(conn, testUserId, 50);
    const viewed = await getViewedNewsIds(conn, testUserId, [50]);
    expect(viewed).toEqual(new Set());
  });
});
```

Ensure the test's `beforeAll` calls `ensureViewingHistoryTables` (which now creates both tables) and creates a test user.

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=viewing-history/repository`
Expected: FAIL — `markNewsViewed` not found.

**Step 3: Add news viewing functions to repository**

Add to `packages/server/src/viewing-history/repository.ts`:

```typescript
/** Mark a news item as viewed by a user. Upserts last_viewed_at on repeat views. */
export async function markNewsViewed(
  conn: DuckDBConnection,
  userId: string,
  newsItemId: number,
): Promise<void> {
  const now: string = new Date().toISOString();
  await conn.run(
    `INSERT INTO user_news_view (user_id, news_item_id, first_viewed_at, last_viewed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, news_item_id)
     DO UPDATE SET last_viewed_at = $4`,
    [userId, newsItemId, now, now],
  );
}

/** Mark a news item as unread for a user. */
export async function markNewsUnread(
  conn: DuckDBConnection,
  userId: string,
  newsItemId: number,
): Promise<void> {
  await conn.run(
    `DELETE FROM user_news_view WHERE user_id = $1 AND news_item_id = $2`,
    [userId, newsItemId],
  );
}

/** Check which news item IDs have been viewed by a user. */
export async function getViewedNewsIds(
  conn: DuckDBConnection,
  userId: string,
  newsItemIds: number[],
): Promise<Set<number>> {
  if (newsItemIds.length === 0) return new Set();
  const placeholders: string = newsItemIds.map((_, i) => `$${i + 2}`).join(', ');
  const result = await conn.runAndReadAll(
    `SELECT news_item_id FROM user_news_view
     WHERE user_id = $1 AND news_item_id IN (${placeholders})`,
    [userId, ...newsItemIds],
  );
  return new Set(
    result.getRowObjectsJS().map((row) => Number((row as Record<string, unknown>).news_item_id)),
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=viewing-history/repository`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/viewing-history/repository.ts packages/server/src/viewing-history/repository.test.ts
git commit -m "feat(viewing-history): add news item view tracking to repository"
```

---

### Task 3: News viewing history — API routes

**Files:**
- Modify: `packages/server/src/viewing-history/routes.ts`

**Step 1: Add news mark-read, mark-unread, and bulk-check routes**

Follow the exact same pattern as the existing filing routes. Add after the existing routes:

```typescript
// POST /api/viewing-history/news/mark-read
viewingHistoryRoutes.post('/news/mark-read', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemId: number }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markNewsViewed(conn, user.id, body.newsItemId);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// POST /api/viewing-history/news/mark-unread
viewingHistoryRoutes.post('/news/mark-unread', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemId: number }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markNewsUnread(conn, user.id, body.newsItemId);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// POST /api/viewing-history/news/bulk-check
viewingHistoryRoutes.post('/news/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemIds: number[] }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const viewed: Set<number> = await getViewedNewsIds(conn, user.id, body.newsItemIds);
    return c.json({ viewed: [...viewed] });
  } finally {
    conn.closeSync();
  }
});
```

Add the new imports (`markNewsViewed`, `markNewsUnread`, `getViewedNewsIds`) from `./repository.ts`.

**Step 2: Commit**

```bash
git add packages/server/src/viewing-history/routes.ts
git commit -m "feat(viewing-history): add API routes for news item view tracking"
```

---

### Task 4: Content flag — repository and tests

**Files:**
- Create: `packages/server/src/content-flag/types.ts`
- Create: `packages/server/src/content-flag/repository.ts`
- Create: `packages/server/src/content-flag/repository.test.ts`

**Step 1: Write the types**

```typescript
export type ContentFlagSource = 'manual' | 'alert';

export type ContentFlagRow = {
  id: number;
  user_id: string;
  content_type: string;
  content_key: string;
  source: ContentFlagSource;
  saved_search_id: number | null;
  reason: string | null;
  created_at: string;
  dismissed_at: string | null;
};

export type CreateFlagInput = {
  content_type: string;
  content_key: string;
  source?: ContentFlagSource;
  saved_search_id?: number;
  reason?: string;
};

export type BulkFlagInput = {
  content_type: string;
  content_keys: string[];
  reason?: string;
};
```

**Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureContentFlagTables } from './schema.ts';
import {
  createFlag,
  createBulkFlags,
  dismissFlag,
  getActiveFlagsForUser,
  getActiveFlagKeys,
  undismissFlag,
} from './repository.ts';

describe('content flag repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'test-user-001';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureContentFlagTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should create a manual flag', async () => {
    const id: number = await createFlag(conn, userId, {
      content_type: 'filing',
      content_key: 'SAT-LOA-20250101-00001',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('should not duplicate a flag for the same content', async () => {
    const id: number = await createFlag(conn, userId, {
      content_type: 'filing',
      content_key: 'SAT-LOA-20250101-00001',
    });
    // Should return the existing flag ID (upsert behavior)
    expect(id).toBeGreaterThan(0);

    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const matching = flags.filter((f) => f.content_key === 'SAT-LOA-20250101-00001');
    expect(matching).toHaveLength(1);
  });

  it('should create bulk flags', async () => {
    const ids: number[] = await createBulkFlags(conn, userId, {
      content_type: 'filing',
      content_keys: ['SAT-LOA-20250201-00001', 'SAT-LOA-20250301-00001'],
      reason: 'Interesting filings',
    });
    expect(ids).toHaveLength(2);
  });

  it('should list active flags for a user by content type', async () => {
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    expect(flags.length).toBeGreaterThanOrEqual(3);
    for (const f of flags) {
      expect(f.dismissed_at).toBeNull();
    }
  });

  it('should dismiss a flag (soft delete)', async () => {
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const flagId: number = flags[0]!.id;
    await dismissFlag(conn, flagId, userId);

    const afterDismiss = await getActiveFlagsForUser(conn, userId, 'filing');
    const dismissed = afterDismiss.find((f) => f.id === flagId);
    expect(dismissed).toBeUndefined(); // Not in active list

    // But still in DB
    const allFlags = await conn.runAndReadAll(
      'SELECT dismissed_at FROM user_content_flag WHERE id = $1',
      [flagId],
    );
    expect(allFlags.getRowObjectsJS()[0]!.dismissed_at).not.toBeNull();
  });

  it('should undismiss a previously dismissed flag', async () => {
    const allFlagsReader = await conn.runAndReadAll(
      `SELECT id FROM user_content_flag WHERE user_id = $1 AND dismissed_at IS NOT NULL LIMIT 1`,
      [userId],
    );
    const dismissedId: number = Number(allFlagsReader.getRowObjectsJS()[0]!.id);
    await undismissFlag(conn, dismissedId, userId);

    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const restored = flags.find((f) => f.id === dismissedId);
    expect(restored).toBeDefined();
    expect(restored!.dismissed_at).toBeNull();
  });

  it('should return active flag keys for bulk UI checks', async () => {
    const keys: Set<string> = await getActiveFlagKeys(
      conn,
      userId,
      'filing',
      ['SAT-LOA-20250101-00001', 'SAT-LOA-20250201-00001', 'NONEXISTENT'],
    );
    expect(keys.has('SAT-LOA-20250101-00001')).toEqual(true);
    expect(keys.has('SAT-LOA-20250201-00001')).toEqual(true);
    expect(keys.has('NONEXISTENT')).toEqual(false);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=content-flag/repository`
Expected: FAIL — module not found.

**Step 4: Write the repository**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import type { ContentFlagRow, CreateFlagInput, BulkFlagInput } from './types.ts';

/** Create or re-activate a single flag. Returns the flag ID. */
export async function createFlag(
  conn: DuckDBConnection,
  userId: string,
  input: CreateFlagInput,
): Promise<number> {
  const source: string = input.source ?? 'manual';
  const savedSearchId: number | null = input.saved_search_id ?? null;

  // Try upsert: if dismissed, re-activate; if already active, return existing
  const reader = await conn.runAndReadAll(
    `INSERT INTO user_content_flag (user_id, content_type, content_key, source, saved_search_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, content_type, content_key, saved_search_id)
     DO UPDATE SET dismissed_at = NULL, reason = COALESCE($6, user_content_flag.reason)
     RETURNING id`,
    [userId, input.content_type, input.content_key, source, savedSearchId, input.reason ?? null],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Create flags for multiple content keys at once. Returns the flag IDs. */
export async function createBulkFlags(
  conn: DuckDBConnection,
  userId: string,
  input: BulkFlagInput,
): Promise<number[]> {
  const ids: number[] = [];
  for (const key of input.content_keys) {
    const id: number = await createFlag(conn, userId, {
      content_type: input.content_type,
      content_key: key,
      reason: input.reason,
    });
    ids.push(id);
  }
  return ids;
}

/** Soft-delete a flag by setting dismissed_at. */
export async function dismissFlag(
  conn: DuckDBConnection,
  flagId: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE user_content_flag SET dismissed_at = current_timestamp
     WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
     RETURNING id`,
    [flagId, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Re-activate a previously dismissed flag. */
export async function undismissFlag(
  conn: DuckDBConnection,
  flagId: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE user_content_flag SET dismissed_at = NULL
     WHERE id = $1 AND user_id = $2 AND dismissed_at IS NOT NULL
     RETURNING id`,
    [flagId, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Get all active (non-dismissed) flags for a user, filtered by content type. */
export async function getActiveFlagsForUser(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
): Promise<ContentFlagRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, content_type, content_key, source,
            saved_search_id, reason,
            created_at::VARCHAR AS created_at,
            dismissed_at::VARCHAR AS dismissed_at
     FROM user_content_flag
     WHERE user_id = $1 AND content_type = $2 AND dismissed_at IS NULL
     ORDER BY created_at DESC`,
    [userId, contentType],
  );
  return reader.getRowObjectsJS() as ContentFlagRow[];
}

/** Check which content keys are actively flagged — for bulk UI display. */
export async function getActiveFlagKeys(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
  contentKeys: string[],
): Promise<Set<string>> {
  if (contentKeys.length === 0) return new Set();
  const placeholders: string = contentKeys.map((_, i) => `$${i + 3}`).join(', ');
  const reader = await conn.runAndReadAll(
    `SELECT content_key FROM user_content_flag
     WHERE user_id = $1 AND content_type = $2 AND dismissed_at IS NULL
       AND content_key IN (${placeholders})`,
    [userId, contentType, ...contentKeys],
  );
  return new Set(
    reader.getRowObjectsJS().map((row) => String((row as Record<string, unknown>).content_key)),
  );
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=content-flag/repository`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/content-flag/types.ts packages/server/src/content-flag/schema.ts packages/server/src/content-flag/repository.ts packages/server/src/content-flag/repository.test.ts
git commit -m "feat(content-flag): add repository with create, dismiss, undismiss, and bulk operations"
```

---

### Task 5: Content flag — API routes

**Files:**
- Create: `packages/server/src/content-flag/routes.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Write the routes**

Follow the same Hono patterns as viewing-history routes: `c.get('user')`, `getDb()`, try/finally.

```typescript
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureContentFlagTables } from './schema.ts';
import {
  createFlag,
  createBulkFlags,
  dismissFlag,
  undismissFlag,
  getActiveFlagsForUser,
  getActiveFlagKeys,
} from './repository.ts';
import type { CreateFlagInput, BulkFlagInput } from './types.ts';

const contentFlagRoutes = new Hono();

// GET /api/flags?content_type=filing — list active flags for current user
contentFlagRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const contentType: string = c.req.query('content_type') ?? 'filing';
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const flags = await getActiveFlagsForUser(conn, user.id, contentType);
    return c.json(flags);
  } finally {
    conn.closeSync();
  }
});

// POST /api/flags — create a single flag
contentFlagRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<CreateFlagInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const id: number = await createFlag(conn, user.id, body);
    return c.json({ id }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/flags/bulk — create flags for multiple content keys
contentFlagRoutes.post('/bulk', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<BulkFlagInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ids: number[] = await createBulkFlags(conn, user.id, body);
    return c.json({ ids }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/flags/bulk-check — check which keys are flagged (for list UI)
contentFlagRoutes.post('/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ content_type: string; content_keys: string[] }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const flagged: Set<string> = await getActiveFlagKeys(
      conn, user.id, body.content_type, body.content_keys,
    );
    return c.json({ flagged: [...flagged] });
  } finally {
    conn.closeSync();
  }
});

// POST /api/flags/:id/dismiss — soft-delete a flag
contentFlagRoutes.post('/:id/dismiss', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ok: boolean = await dismissFlag(conn, id, user.id);
    if (!ok) return c.json({ error: 'Not found or already dismissed' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// POST /api/flags/:id/undismiss — restore a dismissed flag
contentFlagRoutes.post('/:id/undismiss', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ok: boolean = await undismissFlag(conn, id, user.id);
    if (!ok) return c.json({ error: 'Not found or not dismissed' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

export { contentFlagRoutes };
```

**Step 2: Register in app.ts**

```typescript
import { contentFlagRoutes } from './content-flag/routes.ts';
// Mount inside the authenticated middleware group:
app.route('/api/flags', contentFlagRoutes);
```

**Step 3: Commit**

```bash
git add packages/server/src/content-flag/routes.ts packages/server/src/app.ts
git commit -m "feat(content-flag): add API routes for flag CRUD and bulk operations"
```

---

### Task 6: Frontend — 10-second delayed mark-as-read on detail pages

**Files:**
- Modify: `packages/web/src/filings/FilingDetail.tsx`
- Modify: `packages/web/src/news/NewsDetail.tsx`
- Modify: `packages/web/src/lib/viewing-history.ts`

**Step 1: Add a `markNewsRead` function to the viewing-history lib**

In `packages/web/src/lib/viewing-history.ts`, add:

```typescript
export async function markNewsRead(newsItemId: number): Promise<void> {
  await fetch('/api/viewing-history/news/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newsItemId }),
  });
}
```

**Step 2: Change FilingDetail.tsx to use a 10-second timer**

Replace the existing immediate mark-read effect (lines ~194-199):

```typescript
// BEFORE:
useEffect(() => {
  if (filing != null) {
    void markRead(filing.fileNumber);
  }
}, [filing]);
```

With a 10-second delayed version:

```typescript
// AFTER:
useEffect(() => {
  if (filing == null) return;
  const timer = setTimeout(() => {
    void markRead(filing.fileNumber);
  }, 10_000);
  return () => clearTimeout(timer);
}, [filing]);
```

**Step 3: Add the same 10-second timer to NewsDetail.tsx**

In `packages/web/src/news/NewsDetail.tsx`, add a similar useEffect that fires `markNewsRead(item.id)` after 10 seconds. Check how the news item data is loaded in that component and follow the same pattern as the filing detail timer.

**Step 4: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Open a filing detail page — should NOT mark as read immediately
2. Wait 10 seconds — network tab should show the mark-read call
3. Navigate away before 10 seconds — should NOT mark as read
4. Open a news article — same behavior

**Step 5: Commit**

```bash
git add packages/web/src/filings/FilingDetail.tsx packages/web/src/news/NewsDetail.tsx packages/web/src/lib/viewing-history.ts
git commit -m "feat(viewing-history): add 10-second delayed mark-as-read on detail pages"
```

---

### Task 7: Frontend — flag toggle icon on list rows

**Files:**
- Create: `packages/web/src/ui/FlagToggle.tsx`
- Modify: `packages/web/src/search/SearchPage.tsx`

**Step 1: Create a reusable FlagToggle component**

```typescript
import { useState } from 'react';

type FlagToggleProps = {
  contentType: string;
  contentKey: string;
  initialFlagged: boolean;
  onToggle?: (flagged: boolean) => void;
};

export function FlagToggle({ contentType, contentKey, initialFlagged, onToggle }: FlagToggleProps) {
  const [flagged, setFlagged] = useState(initialFlagged);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    try {
      if (flagged) {
        // Need to get the flag ID first — or pass it as a prop
        // For simplicity, the parent should manage flag IDs
        onToggle?.(false);
      } else {
        await fetch('/api/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_type: contentType, content_key: contentKey }),
        });
        onToggle?.(true);
      }
      setFlagged(!flagged);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void toggle(); }}
      disabled={loading}
      className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded"
      title={flagged ? 'Unflag' : 'Flag for later'}
    >
      {flagged ? '⚑' : '⚐'}
    </button>
  );
}
```

Note: the exact icon/emoji should match the project's UI conventions. Check `packages/web/src/ui/` for existing icon patterns (e.g., Lucide icons, heroicons, or plain SVGs). Replace the flag emoji with the appropriate icon component.

**Step 2: Integrate into search results tables**

In `SearchPage.tsx`, for the filing results table columns and news results, add a flag column. On mount or when results change, call `POST /api/flags/bulk-check` with the visible content keys to determine which are already flagged.

This is a significant UI integration. Key steps:
1. After search results load, call `/api/flags/bulk-check` with the result keys
2. Store the flagged set in component state
3. Add a flag column to the table that renders `<FlagToggle>` per row
4. On toggle, update the local flagged set optimistically

**Step 3: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Run a filing search
2. Flag icon should appear on each result row
3. Click a flag — should toggle and persist
4. Refresh — flagged state should be preserved

**Step 4: Commit**

```bash
git add packages/web/src/ui/FlagToggle.tsx packages/web/src/search/SearchPage.tsx
git commit -m "feat(content-flag): add flag toggle icons to search result rows"
```

---

### Task 8: Frontend — checkbox bulk flagging on search results

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`

**Step 1: Add row selection state**

Add a `Set<string>` state for selected content keys. Add a checkbox column as the first column in the filing and news result tables. Add a "select all on page" checkbox in the column header.

**Step 2: Add "Flag Selected" toolbar button**

When selection is non-empty, show a toolbar above the table with:
- "N selected" count
- "Flag Selected" button — calls `POST /api/flags/bulk` with the selected keys
- "Clear Selection" button

**Step 3: Wire up the bulk flag action**

```typescript
const handleBulkFlag = async () => {
  const contentType = activeTab === 'filings' ? 'filing' : 'news';
  await fetch('/api/flags/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content_type: contentType,
      content_keys: [...selectedKeys],
      reason: 'Bulk flagged from search',
    }),
  });
  // Update local flagged state and clear selection
};
```

**Step 4: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Run a filing search
2. Check several rows
3. Click "Flag Selected"
4. Verify all selected items show as flagged
5. Verify "select all" works

**Step 5: Commit**

```bash
git add packages/web/src/search/SearchPage.tsx
git commit -m "feat(content-flag): add checkbox bulk flagging to search results"
```

---

### Task 9: Frontend — flag button on detail pages

**Files:**
- Modify: `packages/web/src/filings/FilingDetail.tsx`
- Modify: `packages/web/src/news/NewsDetail.tsx`

**Step 1: Add flag button to filing detail page**

In the filing detail header area (near the title/file number), add a `<FlagToggle>` component. On mount, check if the filing is flagged via `POST /api/flags/bulk-check` with the single file number.

**Step 2: Add flag button to news detail page**

Same pattern — add `<FlagToggle>` to the news article header. Use `content_type: 'news'` and `content_key: String(newsItemId)`.

**Step 3: Verify manually and commit**

```bash
git add packages/web/src/filings/FilingDetail.tsx packages/web/src/news/NewsDetail.tsx
git commit -m "feat(content-flag): add flag toggle to filing and news detail pages"
```

---

## Summary of Deliverables

| What | Where |
|------|-------|
| `user_news_view` schema | `packages/server/src/viewing-history/schema.ts` (modified) |
| `user_content_flag` schema | `packages/server/src/content-flag/schema.ts` |
| News view repository + tests | `packages/server/src/viewing-history/repository.ts` + `.test.ts` (modified) |
| News view API routes | `packages/server/src/viewing-history/routes.ts` (modified) |
| Content flag types | `packages/server/src/content-flag/types.ts` |
| Content flag repository + tests | `packages/server/src/content-flag/repository.ts` + `.test.ts` |
| Content flag API routes | `packages/server/src/content-flag/routes.ts` |
| App registration | `packages/server/src/app.ts` (modified) |
| 10-second mark-as-read | `packages/web/src/filings/FilingDetail.tsx`, `NewsDetail.tsx` (modified) |
| FlagToggle component | `packages/web/src/ui/FlagToggle.tsx` |
| List flag icons + bulk flagging | `packages/web/src/search/SearchPage.tsx` (modified) |
| Detail page flag buttons | `FilingDetail.tsx`, `NewsDetail.tsx` (modified) |

## What This Unblocks

With viewing history covering both content types and the flagging system in place, the Alert Evaluation plan can:
- Write alert-generated flags to `user_content_flag` with `source='alert'` and `saved_search_id` set
- The dashboard can query "unviewed AND flagged" content for prominence display
- Flag dismissal analytics become available for tuning alert quality
