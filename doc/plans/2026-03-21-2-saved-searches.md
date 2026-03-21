# Saved Searches Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to save filing and news searches by name, re-run them from the API, and populate the search form from a saved search — laying the foundation for the alerting system.

**Architecture:** New `saved_search` table in DuckDB stores user-owned search definitions as structured JSON filters with a content type discriminator (`filing` or `news`). A new `saved-search` module provides schema, repository, routes, and an execution service that dispatches to the existing `searchFilings`/`searchFilingContent`/`searchNewsByKeyword` functions. The frontend gets a "Save Search" button on the search results page that opens a name-entry modal. Searches with date filters are saved with `include_time_scope = true`; those without are eligible for future alerting.

**Tech Stack:** DuckDB (existing), Hono API routes (existing), React + TanStack (existing frontend), TypeScript

**Depends on:** None (independent of pipeline-tracking plan)

---

### Task 1: Schema — `saved_search` table

**Files:**
- Create: `packages/server/src/saved-search/schema.ts`

**Step 1: Write the schema file**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureSavedSearchTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS saved_search_id_seq START 1;
    CREATE TABLE IF NOT EXISTS saved_search (
      id                 INTEGER NOT NULL DEFAULT nextval('saved_search_id_seq') PRIMARY KEY,
      user_id            VARCHAR NOT NULL REFERENCES "user"(id),
      name               VARCHAR NOT NULL,
      content_type       VARCHAR NOT NULL,
      filters            JSON NOT NULL,
      include_time_scope BOOLEAN NOT NULL DEFAULT true,
      alert_enabled      BOOLEAN NOT NULL DEFAULT false,
      created_at         TIMESTAMP NOT NULL DEFAULT current_timestamp,
      updated_at         TIMESTAMP NOT NULL DEFAULT current_timestamp
    );
  `);
}
```

**Step 2: Commit**

```bash
git add packages/server/src/saved-search/schema.ts
git commit -m "feat(saved-search): add schema for saved_search table"
```

---

### Task 2: Types — shared types for saved searches

**Files:**
- Create: `packages/server/src/saved-search/types.ts`

**Step 1: Write the types file**

```typescript
import type { FilingSearchFilters } from '../search/types.ts';

/** News search filters — free-text query with optional mode. */
export type NewsSearchFilters = {
  q: string;
  mode?: 'keyword' | 'semantic' | 'hybrid';
};

export type SavedSearchContentType = 'filing' | 'news';

export type SavedSearchRow = {
  id: number;
  user_id: string;
  name: string;
  content_type: SavedSearchContentType;
  filters: string; // JSON string from DB
  include_time_scope: boolean;
  alert_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SavedSearchResponse = {
  id: number;
  name: string;
  content_type: SavedSearchContentType;
  filters: FilingSearchFilters | NewsSearchFilters;
  include_time_scope: boolean;
  alert_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateSavedSearchInput = {
  name: string;
  content_type: SavedSearchContentType;
  filters: FilingSearchFilters | NewsSearchFilters;
};
```

**Step 2: Commit**

```bash
git add packages/server/src/saved-search/types.ts
git commit -m "feat(saved-search): add shared types for saved search module"
```

---

### Task 3: Repository — CRUD for saved searches

**Files:**
- Create: `packages/server/src/saved-search/repository.ts`
- Create: `packages/server/src/saved-search/repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureSavedSearchTables } from './schema.ts';
import {
  createSavedSearch,
  getSavedSearchById,
  getSavedSearchesForUser,
  deleteSavedSearch,
  updateSavedSearch,
} from './repository.ts';

describe('saved search repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const testUserId: string = 'test-user-001';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Create user table for FK
    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user',
        banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR,
        "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('test-user-001', 'Test', 'test@example.com');
    `);
    await ensureSavedSearchTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should create and retrieve a filing saved search', async () => {
    const filters = {
      subsystem_code: ['SAT'],
      company: 'SpaceX',
    };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'SpaceX SAT filings',
      content_type: 'filing',
      filters,
    });
    expect(id).toBeGreaterThan(0);

    const saved = await getSavedSearchById(conn, id);
    expect(saved).not.toBeNull();
    expect(saved!.name).toEqual('SpaceX SAT filings');
    expect(saved!.content_type).toEqual('filing');
    expect(saved!.filters).toEqual(filters);
    expect(saved!.include_time_scope).toEqual(false);
    expect(saved!.alert_enabled).toEqual(false);
  });

  it('should set include_time_scope=true when date filters are present', async () => {
    const filters = {
      subsystem_code: ['SAT'],
      date_filed_from: '2025-01-01',
    };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'SAT filings 2025',
      content_type: 'filing',
      filters,
    });

    const saved = await getSavedSearchById(conn, id);
    expect(saved!.include_time_scope).toEqual(true);
  });

  it('should create and retrieve a news saved search', async () => {
    const filters = { q: 'spectrum sharing', mode: 'hybrid' as const };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'Spectrum sharing news',
      content_type: 'news',
      filters,
    });

    const saved = await getSavedSearchById(conn, id);
    expect(saved!.content_type).toEqual('news');
    expect(saved!.filters).toEqual(filters);
    expect(saved!.include_time_scope).toEqual(false);
  });

  it('should list all saved searches for a user', async () => {
    const searches = await getSavedSearchesForUser(conn, testUserId);
    expect(searches.length).toBeGreaterThanOrEqual(3);
    // All should belong to our test user
    for (const s of searches) {
      expect(s.user_id).toEqual(testUserId);
    }
  });

  it('should not return searches belonging to other users', async () => {
    const searches = await getSavedSearchesForUser(conn, 'nonexistent-user');
    expect(searches).toHaveLength(0);
  });

  it('should update a saved search name', async () => {
    const searches = await getSavedSearchesForUser(conn, testUserId);
    const first = searches[0]!;
    await updateSavedSearch(conn, first.id, testUserId, { name: 'Renamed' });
    const updated = await getSavedSearchById(conn, first.id);
    expect(updated!.name).toEqual('Renamed');
  });

  it('should delete a saved search', async () => {
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'To delete',
      content_type: 'filing',
      filters: {},
    });
    const deleted: boolean = await deleteSavedSearch(conn, id, testUserId);
    expect(deleted).toEqual(true);
    const result = await getSavedSearchById(conn, id);
    expect(result).toBeNull();
  });

  it('should not delete another user\'s saved search', async () => {
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'Protected',
      content_type: 'filing',
      filters: {},
    });
    const deleted: boolean = await deleteSavedSearch(conn, id, 'other-user');
    expect(deleted).toEqual(false);
    const result = await getSavedSearchById(conn, id);
    expect(result).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=saved-search/repository`
Expected: FAIL — module not found.

**Step 3: Write the repository implementation**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  CreateSavedSearchInput,
  SavedSearchResponse,
  SavedSearchRow,
  FilingSearchFilters,
} from './types.ts';

/** Determine if filing filters contain date constraints. */
function hasTimeScope(input: CreateSavedSearchInput): boolean {
  if (input.content_type === 'news') return false;
  const f = input.filters as FilingSearchFilters;
  return (
    (f.date_filed_from != null && f.date_filed_from.trim() !== '') ||
    (f.date_filed_to != null && f.date_filed_to.trim() !== '')
  );
}

function rowToResponse(row: SavedSearchRow): SavedSearchResponse {
  return {
    id: row.id,
    name: row.name,
    content_type: row.content_type,
    filters: JSON.parse(row.filters),
    include_time_scope: row.include_time_scope,
    alert_enabled: row.alert_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Create a saved search. Returns the new ID. */
export async function createSavedSearch(
  conn: DuckDBConnection,
  userId: string,
  input: CreateSavedSearchInput,
): Promise<number> {
  const includeTimeScope: boolean = hasTimeScope(input);
  const reader = await conn.runAndReadAll(
    `INSERT INTO saved_search (user_id, name, content_type, filters, include_time_scope)
     VALUES ($1, $2, $3, $4::JSON, $5)
     RETURNING id`,
    [userId, input.name, input.content_type, JSON.stringify(input.filters), includeTimeScope],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Get a single saved search by ID. */
export async function getSavedSearchById(
  conn: DuckDBConnection,
  id: number,
): Promise<SavedSearchResponse | null> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search WHERE id = $1`,
    [id],
  );
  const rows = reader.getRowObjectsJS() as SavedSearchRow[];
  if (rows.length === 0) return null;
  return rowToResponse(rows[0]!);
}

/** Get all saved searches for a user, most recent first. */
export async function getSavedSearchesForUser(
  conn: DuckDBConnection,
  userId: string,
): Promise<(SavedSearchResponse & { user_id: string })[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return (reader.getRowObjectsJS() as SavedSearchRow[]).map((r) => ({
    ...rowToResponse(r),
    user_id: r.user_id,
  }));
}

/** Update a saved search (only the owning user may update). */
export async function updateSavedSearch(
  conn: DuckDBConnection,
  id: number,
  userId: string,
  updates: { name?: string; alert_enabled?: boolean },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let paramIndex: number = 1;

  if (updates.name != null) {
    sets.push(`name = $${String(paramIndex)}`);
    params.push(updates.name);
    paramIndex++;
  }
  if (updates.alert_enabled != null) {
    sets.push(`alert_enabled = $${String(paramIndex)}`);
    params.push(updates.alert_enabled);
    paramIndex++;
  }
  if (sets.length === 0) return false;

  sets.push('updated_at = current_timestamp');
  params.push(id, userId);

  const reader = await conn.runAndReadAll(
    `UPDATE saved_search SET ${sets.join(', ')} WHERE id = $${String(paramIndex)} AND user_id = $${String(paramIndex + 1)} RETURNING id`,
    params,
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Delete a saved search (only the owning user may delete). Returns true if deleted. */
export async function deleteSavedSearch(
  conn: DuckDBConnection,
  id: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `DELETE FROM saved_search WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=saved-search/repository`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/saved-search/repository.ts packages/server/src/saved-search/repository.test.ts
git commit -m "feat(saved-search): add repository with CRUD operations and tests"
```

---

### Task 4: Execution service — re-run saved searches via API

**Files:**
- Create: `packages/server/src/saved-search/execute.ts`
- Create: `packages/server/src/saved-search/execute.test.ts`

**Step 1: Write the failing test**

This test verifies that the execution service dispatches to the correct search function based on content type. It uses a real in-memory DuckDB with the filing and news tables seeded.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { executeSavedSearch } from './execute.ts';
import type { FilingSearchFilters } from '../search/types.ts';
import type { NewsSearchFilters } from './types.ts';

describe('saved search execution', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Create minimal filing table for search
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL,
        app_type_code VARCHAR NOT NULL,
        status_code VARCHAR,
        date_filed TIMESTAMP,
        company_id INTEGER,
        _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        summary VARCHAR,
        attachment_name VARCHAR
      );
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20250101-00001', 'E123', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2025-01-15', NULL, '2025-01-15');
    `);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should execute a filing search with saved filters', async () => {
    const filters: FilingSearchFilters = { subsystem_code: ['SAT'] };
    const result = await executeSavedSearch(conn, 'filing', filters, { page: 1, pageSize: 10 });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should execute a filing search scoped to new items since a timestamp', async () => {
    const filters: FilingSearchFilters = { subsystem_code: ['SAT'] };
    // Items since far in the future should return nothing
    const result = await executeSavedSearch(conn, 'filing', filters, { page: 1, pageSize: 10 }, '2099-01-01');
    expect(result.data).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=saved-search/execute`
Expected: FAIL — module not found.

**Step 3: Write the execution service**

The execution service wraps the existing search functions, optionally injecting a `_first_seen_at > sinceTimestamp` constraint for alert evaluation.

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import type { FilingSearchFilters, PaginatedRequest, PaginatedResponse } from '../search/types.ts';
import type { NewsSearchFilters, SavedSearchContentType } from './types.ts';
import { searchFilings } from '../search/repository.ts';
import { searchNewsByKeyword } from '../search/news-search.ts';

/**
 * Execute a saved search against the database.
 * If `sinceTimestamp` is provided, only items first seen after that timestamp are returned.
 * This is used by the alert evaluation system to scope to new content.
 */
export async function executeSavedSearch(
  conn: DuckDBConnection,
  contentType: SavedSearchContentType,
  filters: FilingSearchFilters | NewsSearchFilters,
  pagination: PaginatedRequest,
  sinceTimestamp?: string,
): Promise<PaginatedResponse<unknown>> {
  if (contentType === 'filing') {
    const filingFilters: FilingSearchFilters = {
      ...(filters as FilingSearchFilters),
    };
    // For alert scoping, inject a date_filed_from constraint if sinceTimestamp is provided
    // and the saved search doesn't already have a time scope.
    // Note: this is a simplification — a more precise approach would filter on _first_seen_at
    // at the repository level. That refinement belongs in the alert evaluation plan.
    if (sinceTimestamp != null) {
      filingFilters.date_filed_from = sinceTimestamp;
    }
    return await searchFilings(conn, filingFilters, pagination);
  }

  if (contentType === 'news') {
    const newsFilters = filters as NewsSearchFilters;
    // searchNewsByKeyword returns NewsSearchHit[] (not paginated).
    // Wrap it in a paginated response for consistency.
    const hits = await searchNewsByKeyword(conn, newsFilters.q, pagination.pageSize);
    return {
      data: hits,
      total: hits.length,
      page: 1,
      pageSize: pagination.pageSize,
      totalPages: 1,
    };
  }

  throw new Error(`Unsupported content type: ${contentType}`);
}
```

Note: The `PaginatedResponse` shape and `PaginatedRequest` type should be imported from wherever the existing search code defines them. Check `packages/server/src/search/types.ts` and `packages/server/src/lib/pagination.ts` (or similar) for the exact import paths. Adjust as needed.

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=saved-search/execute`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/saved-search/execute.ts packages/server/src/saved-search/execute.test.ts
git commit -m "feat(saved-search): add execution service for re-running saved searches"
```

---

### Task 5: API routes — saved search CRUD and execution

**Files:**
- Create: `packages/server/src/saved-search/routes.ts`

**Step 1: Write the routes**

Follow the same patterns as `packages/server/src/viewing-history/routes.ts` — use `c.get('user')` for auth, `getDb()` + `DuckDBConnection.create()` for connections, `try/finally` with `conn.closeSync()`.

```typescript
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureSavedSearchTables } from './schema.ts';
import {
  createSavedSearch,
  getSavedSearchById,
  getSavedSearchesForUser,
  updateSavedSearch,
  deleteSavedSearch,
} from './repository.ts';
import { executeSavedSearch } from './execute.ts';
import type { CreateSavedSearchInput } from './types.ts';

const savedSearchRoutes = new Hono();

// GET /api/saved-searches — list current user's saved searches
savedSearchRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const searches = await getSavedSearchesForUser(conn, user.id);
    return c.json(searches);
  } finally {
    conn.closeSync();
  }
});

// GET /api/saved-searches/:id — get a single saved search
savedSearchRoutes.get('/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const saved = await getSavedSearchById(conn, id);
    if (saved == null) return c.json({ error: 'Not found' }, 404);
    return c.json(saved);
  } finally {
    conn.closeSync();
  }
});

// POST /api/saved-searches — create a new saved search
savedSearchRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<CreateSavedSearchInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const id: number = await createSavedSearch(conn, user.id, body);
    const saved = await getSavedSearchById(conn, id);
    return c.json(saved, 201);
  } finally {
    conn.closeSync();
  }
});

// PATCH /api/saved-searches/:id — update name or alert_enabled
savedSearchRoutes.patch('/:id', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; alert_enabled?: boolean }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const updated: boolean = await updateSavedSearch(conn, id, user.id, body);
    if (!updated) return c.json({ error: 'Not found or not owned' }, 404);
    const saved = await getSavedSearchById(conn, id);
    return c.json(saved);
  } finally {
    conn.closeSync();
  }
});

// DELETE /api/saved-searches/:id
savedSearchRoutes.delete('/:id', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const deleted: boolean = await deleteSavedSearch(conn, id, user.id);
    if (!deleted) return c.json({ error: 'Not found or not owned' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// GET /api/saved-searches/:id/execute — re-run a saved search
savedSearchRoutes.get('/:id/execute', async (c) => {
  const id: number = Number(c.req.param('id'));
  const page: number = Number(c.req.query('page') ?? '1');
  const pageSize: number = Math.min(Number(c.req.query('pageSize') ?? '25'), 100);
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureSavedSearchTables(conn);
    const saved = await getSavedSearchById(conn, id);
    if (saved == null) return c.json({ error: 'Not found' }, 404);
    const result = await executeSavedSearch(
      conn,
      saved.content_type,
      saved.filters,
      { page, pageSize },
    );
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});

export { savedSearchRoutes };
```

**Step 2: Register the routes in the app**

In `packages/server/src/app.ts`, add the import and mount:

```typescript
import { savedSearchRoutes } from './saved-search/routes.ts';
```

Mount it alongside the other authenticated routes (look at how `viewingHistoryRoutes` is mounted for the exact pattern — likely something like):

```typescript
app.route('/api/saved-searches', savedSearchRoutes);
```

Ensure it's inside the authenticated middleware group, same as viewing history routes.

**Step 3: Commit**

```bash
git add packages/server/src/saved-search/routes.ts packages/server/src/app.ts
git commit -m "feat(saved-search): add API routes for CRUD and execution"
```

---

### Task 6: Frontend — "Save Search" button and modal

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`

This task adds a "Save Search" button that appears in the search results area. Clicking it opens a simple modal with a name input. On submit, it POSTs to `/api/saved-searches`.

**Step 1: Add a SaveSearchModal component**

Add this near the top of `SearchPage.tsx` (or in a separate file if the page is already large — check the file size first). The component should:

- Accept `isOpen`, `onClose`, `onSave` props
- Render a modal dialog with a name text input and Save/Cancel buttons
- On save, call `onSave(name)` and close

Use the same UI component library / CSS patterns already in use in the search page. Check if there's an existing modal or dialog component in `packages/web/src/ui/` before creating a new one.

**Step 2: Add save handler to SearchPage**

In the `SearchPage` component, add state for the modal and a save handler:

```typescript
const [showSaveModal, setShowSaveModal] = useState(false);

const handleSaveSearch = async (name: string) => {
  // Determine content type from active tab
  const contentType = activeTab === 'content' ? 'filing' : activeTab === 'news' ? 'news' : null;
  if (contentType == null) return; // Satellites/earth-stations not saveable

  // Build the filters object from current state
  const filters = contentType === 'filing'
    ? { ...filingFilters, ...(contentQuery ? { q: contentQuery } : {}) }
    : { q: contentQuery, mode: searchMode };

  await fetch('/api/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content_type: contentType, filters }),
  });
  setShowSaveModal(false);
  // Optional: show a toast notification
};
```

**Step 3: Add the Save Search button**

Place a "Save Search" button in the search results toolbar area, visible only on the filing and content/news tabs. The button should be disabled if no search has been performed yet (i.e., no filters active).

**Step 4: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Navigate to the search page
2. Run a filing search with some filters
3. Click "Save Search", enter a name, save
4. Verify the API call succeeds (check network tab)
5. Verify the search appears in the DB: `duckdb data/daily-orbit-query.duckdb -c "SELECT * FROM saved_search"`

**Step 5: Commit**

```bash
git add packages/web/src/search/SearchPage.tsx
git commit -m "feat(saved-search): add Save Search button and modal to search page"
```

---

### Task 7: Frontend — load saved search into search form

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`

**Step 1: Add a saved searches dropdown or list**

Add a UI element (dropdown, sidebar list, or toolbar dropdown) that lists the user's saved searches. Fetch from `GET /api/saved-searches` on mount.

**Step 2: On click, populate the search form**

When a user clicks a saved search:
1. Parse the `content_type` to determine which tab to activate
2. Set the filter state from the saved `filters` object
3. Trigger the search (call the same fetch function used by the Search button)

This effectively "loads" the saved search into the form, letting the user see and tweak it before or after results load.

**Step 3: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Save a search (from Task 6)
2. Clear the search form
3. Click the saved search from the list
4. Verify filters are populated and results load

**Step 4: Commit**

```bash
git add packages/web/src/search/SearchPage.tsx
git commit -m "feat(saved-search): load saved searches into search form"
```

---

## Summary of Deliverables

| What | Where |
|------|-------|
| Schema DDL | `packages/server/src/saved-search/schema.ts` |
| Shared types | `packages/server/src/saved-search/types.ts` |
| Repository + tests | `packages/server/src/saved-search/repository.ts` + `.test.ts` |
| Execution service + tests | `packages/server/src/saved-search/execute.ts` + `.test.ts` |
| API routes | `packages/server/src/saved-search/routes.ts` |
| App registration | `packages/server/src/app.ts` (modified) |
| Frontend save modal | `packages/web/src/search/SearchPage.tsx` (modified) |
| Frontend load from saved | `packages/web/src/search/SearchPage.tsx` (modified) |

## What This Unblocks

With saved searches persisted and executable via API, the alert evaluation plan can:
- Query `saved_search WHERE alert_enabled = true` to find alertable searches
- Call `executeSavedSearch()` with a `sinceTimestamp` from the pipeline run log
- Flag matches in `user_content_flag`
