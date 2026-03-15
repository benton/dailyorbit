# v0.1.7: Admin Summary Stats & Visualization Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add summary statistics to the admin dashboard and integrate Cosmograph for data visualization, laying the foundation for the entity modeling and analytics work in v0.2.0.

**Architecture:** A new `stats` module on the server provides aggregate queries over the `filing` and `attachment` tables, exposed via `/api/admin/stats`. The frontend admin area gets two new pages: a dashboard with summary stat cards, and a visualization page using Cosmograph to render a network graph of top applicants and their filings. The Cosmograph React library runs DuckDB-WASM in the browser, so the viz page receives JSON data from the API and Cosmograph handles the rendering.

**Tech Stack:** DuckDB (server-side queries), Hono (API routes), Cosmograph v2 (`@cosmograph/react`), React 19, Tailwind CSS

**Key files reference:**
- API app: `packages/server/src/app.ts`
- Existing routes pattern: `packages/server/src/config/routes.ts`
- Admin layout: `packages/web/src/admin/AdminLayout.tsx`
- App routes: `packages/web/src/App.tsx`
- API helper: `packages/web/src/lib/api.ts`
- Vite config (has Cosmograph CSS shim): `packages/web/vite.config.ts`

**Prerequisites:**
- `@cosmograph/react` is already installed in `packages/web`
- Vite config already has the `cosmographCssShim` plugin (both Rollup and esbuild)

---

## Task 1: Stats Repository — Query Functions

Build the data access layer for summary statistics.

**Files:**
- Create: `packages/server/src/stats/repository.ts`
- Create: `packages/server/src/stats/repository.test.ts`
- Create: `packages/server/src/stats/types.ts`

**Step 1: Define the stats types**

```typescript
// packages/server/src/stats/types.ts
export type SubsystemCount = {
  subsystem_code: string;
  count: number;
};

export type AttachmentStats = {
  total: number;
  downloaded: number;
  pending: number;
  failed: number;
  total_bytes: number;
};

export type DatasetStats = {
  filing_count: number;
  filings_by_subsystem: SubsystemCount[];
  attachment_stats: AttachmentStats;
  db_size_bytes: number;
};
```

**Step 2: Write failing tests for the repository**

The tests use in-memory DuckDB. They need to create the `filing` and `attachment` tables with minimal schemas matching what the ingest pipeline creates. Write tests for:
- `getFilingCount` returns total count
- `getFilingsBySubsystem` returns grouped counts sorted descending
- `getAttachmentStats` returns counts by status and total bytes
- `getDbSizeBytes` returns a number (use 0 for in-memory)

Refer to `packages/server/src/config/routes.test.ts` for the test setup pattern (DuckDBInstance + beforeEach/afterEach).

The filing table in tests needs at minimum: `filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL, subsystem_code VARCHAR NOT NULL, app_type_code VARCHAR NOT NULL`. Create it with `CREATE TABLE IF NOT EXISTS`.

The attachment table needs at minimum: `attachment_key INTEGER NOT NULL, filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL, attachment_name VARCHAR NOT NULL, download_status VARCHAR NOT NULL DEFAULT 'pending', file_size_bytes BIGINT`. Match the schema in `packages/server/src/attachments/repository.ts:CREATE_TABLE_SQL`.

**Step 3: Run tests — expect FAIL (functions don't exist)**

```bash
make test
```

**Step 4: Implement the repository functions**

```typescript
// packages/server/src/stats/repository.ts
import type { DuckDBConnection } from '@duckdb/node-api';
import type { AttachmentStats, DatasetStats, SubsystemCount } from './types.ts';

export async function getFilingCount(conn: DuckDBConnection): Promise<number> {
  const result = await conn.runAndReadAll('SELECT count(*)::INTEGER AS cnt FROM filing');
  const rows = result.getRowObjectsJS();
  return Number(rows[0]?.cnt ?? 0);
}

export async function getFilingsBySubsystem(conn: DuckDBConnection): Promise<SubsystemCount[]> {
  const result = await conn.runAndReadAll(
    `SELECT subsystem_code, count(*)::INTEGER AS count
     FROM filing
     GROUP BY subsystem_code
     ORDER BY count DESC`
  );
  return result.getRowObjectsJS().map((r) => ({
    subsystem_code: String(r.subsystem_code),
    count: Number(r.count),
  }));
}

export async function getAttachmentStats(conn: DuckDBConnection): Promise<AttachmentStats> {
  const result = await conn.runAndReadAll(
    `SELECT
       count(*)::INTEGER AS total,
       count(*) FILTER (WHERE download_status = 'downloaded')::INTEGER AS downloaded,
       count(*) FILTER (WHERE download_status = 'pending')::INTEGER AS pending,
       count(*) FILTER (WHERE download_status = 'failed')::INTEGER AS failed,
       coalesce(sum(file_size_bytes), 0)::BIGINT AS total_bytes
     FROM attachment`
  );
  const row = result.getRowObjectsJS()[0]!;
  return {
    total: Number(row.total),
    downloaded: Number(row.downloaded),
    pending: Number(row.pending),
    failed: Number(row.failed),
    total_bytes: Number(row.total_bytes),
  };
}

export async function getDbSizeBytes(dbPath: string): Promise<number> {
  try {
    const { statSync } = await import('node:fs');
    return statSync(dbPath).size;
  } catch {
    return 0;
  }
}

export async function getDatasetStats(
  conn: DuckDBConnection,
  dbPath: string,
): Promise<DatasetStats> {
  const [filing_count, filings_by_subsystem, attachment_stats, db_size_bytes] =
    await Promise.all([
      getFilingCount(conn),
      getFilingsBySubsystem(conn),
      getAttachmentStats(conn),
      getDbSizeBytes(dbPath),
    ]);
  return { filing_count, filings_by_subsystem, attachment_stats, db_size_bytes };
}
```

**Step 5: Run tests — expect PASS**

```bash
make test
```

**Step 6: Commit**

```
feat(stats): add dataset statistics repository with DuckDB queries
```

---

## Task 2: Stats API Route

Expose the stats via `/api/admin/stats`.

**Files:**
- Create: `packages/server/src/stats/routes.ts`
- Create: `packages/server/src/stats/index.ts`
- Modify: `packages/server/src/app.ts` (add route mount)

**Step 1: Create the route module**

Follow the pattern in `packages/server/src/config/routes.ts`. The route handler needs a DuckDB connection and the DB path. The DB path is available from the module-level `configuredPath` — but since `db.ts` doesn't export it, we need to either:
- Add a `getDbPath()` export to `packages/server/src/lib/db.ts`, OR
- Pass it through from the config service

The simplest approach: add `getDbPath()` to `db.ts`.

```typescript
// Add to packages/server/src/lib/db.ts:
export function getDbPath(): string {
  if (configuredPath == null) {
    throw new Error('Database path not configured');
  }
  return configuredPath;
}
```

```typescript
// packages/server/src/stats/routes.ts
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { getDbPath } from '../lib/db.ts';
import { getDatasetStats } from './repository.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';

const statsRoutes = new Hono();

statsRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const stats = await getDatasetStats(conn, getDbPath());
    return c.json(stats);
  } finally {
    conn.closeSync();
  }
});

export { statsRoutes };
```

```typescript
// packages/server/src/stats/index.ts
export { statsRoutes } from './routes.ts';
```

**Step 2: Mount the route in app.ts**

Add after the config routes line:

```typescript
import { statsRoutes } from './stats/routes.ts';
// ...
app.route('/api/admin/stats', statsRoutes);
```

**Step 3: Run tests — expect PASS (no regressions)**

```bash
make test
```

**Step 4: Commit**

```
feat(stats): add /api/admin/stats API endpoint
```

---

## Task 3: Top Applicants Query

Add a query that returns the top N applicants by filing count — this powers the Cosmograph network graph.

**Files:**
- Modify: `packages/server/src/stats/repository.ts`
- Modify: `packages/server/src/stats/repository.test.ts`
- Modify: `packages/server/src/stats/types.ts`
- Modify: `packages/server/src/stats/routes.ts`

**Step 1: Add types**

```typescript
// Add to types.ts:
export type ApplicantNode = {
  id: string;
  name: string;
  filing_count: number;
};

export type ApplicantFiling = {
  applicant_name: string;
  file_number: string;
  subsystem_code: string;
  app_type_code: string;
  date_filed: string | null;
  status_code: string | null;
};
```

**Step 2: Write failing tests**

Test that `getTopApplicants` returns applicant names with filing counts, and `getApplicantFilings` returns the filings linked to those applicants. The applicant name comes from `address_attention` on the filing table (the ICFS-enriched field). For IBFS-only filings, fall back to joining on `address_key` to the `address` table's `address_name` — but for v0.1.7 we can use just `address_attention` since ICFS filings are the active data source.

Insert test filings with `address_attention` values like 'SpaceX', 'SES S.A.', etc.

**Step 3: Implement**

```typescript
export async function getTopApplicants(
  conn: DuckDBConnection,
  limit: number = 20,
): Promise<ApplicantNode[]> {
  const result = await conn.runAndReadAll(
    `SELECT
       address_attention AS name,
       count(*)::INTEGER AS filing_count
     FROM filing
     WHERE address_attention IS NOT NULL AND address_attention != ''
     GROUP BY address_attention
     ORDER BY filing_count DESC
     LIMIT ?`,
    [limit],
  );
  return result.getRowObjectsJS().map((r, i) => ({
    id: `applicant-${String(i)}`,
    name: String(r.name),
    filing_count: Number(r.filing_count),
  }));
}

export async function getApplicantFilings(
  conn: DuckDBConnection,
  applicantNames: string[],
): Promise<ApplicantFiling[]> {
  if (applicantNames.length === 0) return [];
  const placeholders: string = applicantNames.map(() => '?').join(', ');
  const result = await conn.runAndReadAll(
    `SELECT
       address_attention AS applicant_name,
       file_number,
       subsystem_code,
       app_type_code,
       date_filed::VARCHAR AS date_filed,
       status_code
     FROM filing
     WHERE address_attention IN (${placeholders})
     ORDER BY date_filed DESC`,
    applicantNames,
  );
  return result.getRowObjectsJS().map((r) => ({
    applicant_name: String(r.applicant_name),
    file_number: String(r.file_number),
    subsystem_code: String(r.subsystem_code),
    app_type_code: String(r.app_type_code),
    date_filed: r.date_filed != null ? String(r.date_filed) : null,
    status_code: r.status_code != null ? String(r.status_code) : null,
  }));
}
```

**Step 4: Add API endpoint**

Add to `statsRoutes`:

```typescript
statsRoutes.get('/applicant-graph', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const limit: number = Number(c.req.query('limit') ?? '20');
    const applicants = await getTopApplicants(conn, limit);
    const names: string[] = applicants.map((a) => a.name);
    const filings = await getApplicantFilings(conn, names);
    return c.json({ applicants, filings });
  } finally {
    conn.closeSync();
  }
});
```

**Step 5: Run tests — expect PASS**

```bash
make test
```

**Step 6: Commit**

```
feat(stats): add top applicants and applicant-filing queries
```

---

## Task 4: Monthly Filing Volume Query

Powers the histogram visualization.

**Files:**
- Modify: `packages/server/src/stats/repository.ts`
- Modify: `packages/server/src/stats/repository.test.ts`
- Modify: `packages/server/src/stats/types.ts`
- Modify: `packages/server/src/stats/routes.ts`

**Step 1: Add type**

```typescript
export type MonthlyFilingVolume = {
  month: string;        // 'YYYY-MM'
  subsystem_code: string;
  count: number;
};
```

**Step 2: Write failing test**

Insert filings with various `date_filed` values across several months. Assert that `getMonthlyFilingVolume` returns correct month strings and counts grouped by subsystem.

**Step 3: Implement**

```typescript
export async function getMonthlyFilingVolume(
  conn: DuckDBConnection,
): Promise<MonthlyFilingVolume[]> {
  const result = await conn.runAndReadAll(
    `SELECT
       strftime(date_trunc('month', date_filed), '%Y-%m') AS month,
       subsystem_code,
       count(*)::INTEGER AS count
     FROM filing
     WHERE date_filed IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 1, 2`
  );
  return result.getRowObjectsJS().map((r) => ({
    month: String(r.month),
    subsystem_code: String(r.subsystem_code),
    count: Number(r.count),
  }));
}
```

**Step 4: Add API endpoint**

```typescript
statsRoutes.get('/filing-volume', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const volume = await getMonthlyFilingVolume(conn);
    return c.json(volume);
  } finally {
    conn.closeSync();
  }
});
```

**Step 5: Run tests — expect PASS**

```bash
make test
```

**Step 6: Commit**

```
feat(stats): add monthly filing volume query and endpoint
```

---

## Task 5: Admin Dashboard Page — Summary Stats Cards

**Files:**
- Create: `packages/web/src/admin/Dashboard.tsx`
- Modify: `packages/web/src/admin/AdminLayout.tsx` (add nav link)
- Modify: `packages/web/src/App.tsx` (add route)

**Step 1: Create the Dashboard component**

Use `apiFetch` to call `/api/admin/stats`. Display cards for:
- Total Filings (number)
- Filings by Subsystem (small table or list)
- Attachments: total / downloaded / pending / failed
- Total Attachment Size (formatted as MB/GB)
- Database File Size (formatted as MB/GB)

Follow the existing styling patterns from `ConfigEditor.tsx` (Tailwind classes, card borders, dark mode support).

```typescript
// packages/web/src/admin/Dashboard.tsx
// A React component that fetches DatasetStats from /api/admin/stats
// and renders stat cards in a CSS grid.
```

Utility: a `formatBytes(bytes: number): string` helper that formats to KB/MB/GB.

**Step 2: Add nav link in AdminLayout**

Add a "Dashboard" link alongside the existing "Config" link, pointing to `/admin`.

**Step 3: Wire routes in App.tsx**

```typescript
// Make Dashboard the index route, move ConfigEditor to /admin/config
<Route element={<AdminLayout />} path="/admin">
  <Route element={<Dashboard />} index />
  <Route element={<ConfigEditor />} path="config" />
</Route>
```

Update AdminLayout nav links accordingly (Dashboard → `/admin`, Config → `/admin/config`).

**Step 4: Run build to verify**

```bash
pnpm --filter @daily-orbit/web build
```

**Step 5: Commit**

```
feat(admin): add summary statistics dashboard page
```

---

## Task 6: Cosmograph Applicant Network Graph Page

**Files:**
- Create: `packages/web/src/admin/ApplicantGraph.tsx`
- Modify: `packages/web/src/admin/AdminLayout.tsx` (add nav link)
- Modify: `packages/web/src/App.tsx` (add route)
- Delete: `packages/web/src/admin/CosmographTest.tsx` (cleanup smoke test)

**Step 1: Build the graph component**

Fetch data from `/api/admin/stats/applicant-graph`. Transform the response into Cosmograph's v2 data format:

**Points:** Combine applicants and filings into one array:
- Each applicant → `{ id: 'applicant-N', idx: N, label: name, type: 'applicant', size: filing_count }`
- Each filing → `{ id: file_number, idx: applicantCount + M, label: file_number, type: 'filing', size: 1 }`

**Links:** For each filing, create a link from its applicant to the filing:
- `{ source: applicantId, target: file_number, sourceIdx: ..., targetIdx: ... }`

Configure Cosmograph:
- `pointColorBy="type"` with a color map: applicant = blue, filing = amber
- `pointSizeBy="size"` so applicants with more filings are larger
- `pointLabelBy="label"`
- Enable simulation for force-directed layout

**Step 2: Add route at `/admin/graph`**

**Step 3: Add "Graph" nav link in AdminLayout**

**Step 4: Remove CosmographTest.tsx and its route**

**Step 5: Build and verify**

```bash
pnpm --filter @daily-orbit/web build
```

**Step 6: Commit**

```
feat(admin): add Cosmograph applicant-filing network graph
```

---

## Task 7: Filing Volume Histogram Page (Stretch)

This task uses Cosmograph's built-in `vg` (vgplot/Mosaic) export to render a stacked bar chart of monthly filing volume by subsystem. This is the more advanced integration — if the Mosaic API proves too undocumented, a simpler approach is to render a plain HTML/CSS bar chart.

**Files:**
- Create: `packages/web/src/admin/FilingVolume.tsx`
- Modify: `packages/web/src/admin/AdminLayout.tsx`
- Modify: `packages/web/src/App.tsx`

**Step 1: Fetch data from `/api/admin/stats/filing-volume`**

**Step 2: Render a stacked bar chart**

Option A (Cosmograph vgplot): Use the `vg` export from `@cosmograph/react` to create a Mosaic plot. This is experimental — consult `@uwdata/vgplot` docs if needed.

Option B (Fallback): Render a simple horizontal stacked bar chart using `<div>` elements with Tailwind widths proportional to counts. Each subsystem gets a distinct color. This is quick, readable, and doesn't require additional libraries.

**Step 3: Add route at `/admin/volume` and nav link**

**Step 4: Build and verify**

```bash
pnpm --filter @daily-orbit/web build
```

**Step 5: Commit**

```
feat(admin): add filing volume histogram page
```

---

## Task 8: Version Bump & Roadmap Update

**Files:**
- Modify: `packages/server/package.json` (version → 0.1.7)
- Modify: `packages/web/package.json` (version → 0.1.7)
- Modify: `doc/roadmap.md` (check off v0.1.7)

**Step 1: Bump versions**

**Step 2: Update roadmap**

Change `- v0.1.7 [ ]` to `- v0.1.7 [✅]`

**Step 3: Commit**

```
chore: bump version to 0.1.7
```

---

## Notes

### Cosmograph v2 API Gotchas (discovered during spike)

1. **Required props:** Both `pointIdBy` AND `pointIndexBy` are required. Links need `linkSourceBy`, `linkTargetBy`, `linkSourceIndexBy`, AND `linkTargetIndexBy`. All index columns must be sequential integers starting from 0.

2. **CSS shim required:** Cosmograph's `licensing-manager.js` imports `@/cosmograph/style.module.css` which isn't shipped in the npm package. The Vite config has shims for both Rollup (production) and esbuild (dev). See `packages/web/vite.config.ts`.

3. **React 19 compatibility:** Works despite peer dep listing React 16-18. Tested and confirmed.

4. **Bundle size:** Cosmograph adds ~2MB to the production bundle (DuckDB-WASM, Arrow, D3). Code-split the admin viz pages with `React.lazy()` to avoid loading it on non-admin routes.

### Applicant Identity (Preview of v0.2.0)

The `address_attention` field on the filing table is the applicant name from ICFS-enriched data. For legacy IBFS-only filings, the applicant name lives in the `address` table (join via `address_key`). The v0.1.7 graph uses `address_attention` only, which covers ICFS filings. Proper entity resolution (fuzzy dedup, FRN-based linking) is v0.2.0 scope.

### Earth Station Geo-Plot (Deferred)

The `earth_station_sta` table has DMS lat/lon coordinates (`lat_deg`, `lat_min`, `lat_sec`, `lat_hemi`, `long_deg`, `long_min`, `long_sec`, `long_hemi`). A geo-plot is feasible but requires a mapping library (Cosmograph doesn't do geo). Deferred to v0.2.0 or later unless there's appetite to add `react-leaflet` now.
