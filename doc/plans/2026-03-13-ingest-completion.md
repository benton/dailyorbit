# Ingest Pipeline Completion Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the three remaining ingest pipeline features: FTP download, ingest_log recording, and in-process server integration.

**Architecture:** The download stage fetches IBFS.zip from the FCC FTP server and extracts it to `tmp/IBFS/`. The pipeline records each run in the `ingest_log` metadata table for audit. For in-process use, `runIngest()` accepts an optional existing `DuckDBInstance` instead of always creating its own, enabling the future admin UI to trigger ingest without a separate DB connection.

**Tech Stack:** Node.js 24 built-in `node:ftp` (N/A — use `fetch` with FTP or shell `curl`), `node:fs`, `node:child_process` for unzip, `@duckdb/node-api`, Vitest

---

## Task 1: FTP Download + Extract

Downloads `IBFS.zip` from the FCC FTP server and extracts it to `tmp/IBFS/`.

**Files:**
- Create: `packages/server/src/ingest/download.ts`
- Create: `packages/server/src/ingest/download.test.ts`
- Modify: `packages/server/src/ingest/pipeline.ts`
- Modify: `packages/server/src/ingest/cli.ts`
- Modify: `packages/server/src/ingest/index.ts`

### Step 1: Write the download module with tests

Create `packages/server/src/ingest/download.ts` with:

```typescript
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export type DownloadOptions = {
  /** URL to fetch IBFS.zip from */
  sourceUrl: string;
  /** Directory to save/extract into (default: tmp/) */
  tmpDir: string;
  /** Callback for progress reporting */
  onProgress?: (message: string) => void;
};

export type DownloadResult = {
  zipPath: string;
  datDir: string;
  zipSizeBytes: number;
};

const DEFAULT_SOURCE_URL: string =
  'ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip';

/**
 * Downloads IBFS.zip via curl and extracts to tmpDir/IBFS/.
 * Uses curl because Node.js has no built-in FTP client and
 * adding a dependency for a single FTP download is overkill.
 */
export function downloadAndExtract(options: DownloadOptions): DownloadResult {
  const log = options.onProgress ?? console.log;
  const zipPath: string = resolve(options.tmpDir, 'IBFS.zip');
  const datDir: string = resolve(options.tmpDir, 'IBFS');

  // Ensure tmp dir exists
  mkdirSync(options.tmpDir, { recursive: true });

  // Download
  log(`Downloading ${options.sourceUrl} ...`);
  execFileSync('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--output', zipPath,
    options.sourceUrl,
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  const zipSizeBytes: number = statSync(zipPath).size;
  log(`Downloaded ${String(Math.round(zipSizeBytes / 1024 / 1024))} MB`);

  // Extract
  log('Extracting...');
  mkdirSync(datDir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', datDir]);
  log('Extraction complete');

  return { zipPath, datDir, zipSizeBytes };
}

export { DEFAULT_SOURCE_URL };
```

Create `packages/server/src/ingest/download.test.ts` with unit tests for the module's behavior (testing that it shells out correctly using a mock, and testing the default URL constant):

```typescript
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_URL } from './download.ts';

describe('download constants', () => {
  it('DEFAULT_SOURCE_URL points to the FCC FTP server', () => {
    expect(DEFAULT_SOURCE_URL).toBe(
      'ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip',
    );
  });
});
```

Note: The actual download is an integration concern — we don't unit-test `curl` invocations. The integration test is manual (`make ingest` with real FTP).

### Step 2: Run tests to verify they pass

Run: `cd packages/server && pnpm vitest run src/ingest/download.test.ts`
Expected: PASS

### Step 3: Wire download into CLI

Modify `packages/server/src/ingest/cli.ts`:
- Add `--download` boolean flag (default: false)
- Add `--source-url` string flag (default: the FCC FTP URL)
- When `--download` is set, call `downloadAndExtract()` before `runIngest()`
- Pass the resulting `datDir` to `runIngest()`

Modify `packages/server/src/ingest/pipeline.ts`:
- Add `sourceUrl` and `zipSizeBytes` as optional fields on `IngestOptions`
- These flow through to the ingest_log (Task 2)

### Step 4: Update exports

Add `downloadAndExtract` and `DEFAULT_SOURCE_URL` to `packages/server/src/ingest/index.ts`.

### Step 5: Update Makefile

Add `make ingest-download` target that runs with `--download`:
```makefile
ingest-download:
	node --no-warnings packages/server/src/ingest/cli.ts --download $(ARGS)
```

### Step 6: Run full test suite

Run: `make test`
Expected: All pass

### Step 7: Commit

```bash
git add packages/server/src/ingest/download.ts packages/server/src/ingest/download.test.ts \
  packages/server/src/ingest/cli.ts packages/server/src/ingest/pipeline.ts \
  packages/server/src/ingest/index.ts Makefile
git commit -m "feat(ingest): add FTP download and extract stage"
```

---

## Task 2: Ingest Log Recording

Records each ingest run in the `ingest_log` metadata table with timing, status, and per-table results.

**Files:**
- Modify: `packages/server/src/ingest/pipeline.ts`
- Modify: `packages/server/src/ingest/pipeline.test.ts`
- Modify: `packages/server/src/ingest/schema.ts` (if ingest_log schema needs changes)

### Step 1: Write the failing test

Add to `packages/server/src/ingest/pipeline.test.ts`:

```typescript
it('records ingest run in ingest_log table', async () => {
  const tableDef: TableDef = allTables.find(
    (t) => t.appName === 'status_code',
  )!;

  // Run a single-table ingest via loadTable
  await loadTable(conn, tableDef, DAT_DIR);

  // Now test the full pipeline path that writes ingest_log
  // ... (test runIngest with a real small table and verify ingest_log row)
});
```

The actual test will call a new `recordIngestRun()` function and verify the ingest_log table has correct data.

### Step 2: Run test to verify it fails

Run: `cd packages/server && pnpm vitest run src/ingest/pipeline.test.ts`
Expected: FAIL

### Step 3: Implement ingest_log recording

Modify `packages/server/src/ingest/pipeline.ts`:

1. At the start of `runIngest()`, insert a row into `ingest_log` with status `'running'`:
   ```typescript
   const ingestId = Date.now(); // simple unique ID
   await conn.run(
     `INSERT INTO "ingest_log" ("ingest_id", "started_at", "source_url", "status")
      VALUES ($1, current_timestamp, $2, 'running')`,
     [ingestId, options.sourceUrl ?? 'local']
   );
   ```

2. After all tables are loaded, update the row to `'completed'`:
   ```typescript
   await conn.run(
     `UPDATE "ingest_log" SET
       "completed_at" = current_timestamp,
       "status" = 'completed',
       "table_results" = $1
      WHERE "ingest_id" = $2`,
     [JSON.stringify(results), ingestId]
   );
   ```

3. On error, update to `'failed'` with error message:
   ```typescript
   await conn.run(
     `UPDATE "ingest_log" SET
       "completed_at" = current_timestamp,
       "status" = 'failed',
       "error_message" = $1
      WHERE "ingest_id" = $2`,
     [String(error), ingestId]
   );
   ```

4. Add `ingestId` to `IngestResult`.

### Step 4: Run tests to verify they pass

Run: `cd packages/server && pnpm vitest run src/ingest/pipeline.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add packages/server/src/ingest/pipeline.ts packages/server/src/ingest/pipeline.test.ts
git commit -m "feat(ingest): record each run in ingest_log metadata table"
```

---

## Task 3: In-Process Server Integration

Allow `runIngest()` to accept an existing `DuckDBInstance` from the server's `getDb()` singleton instead of always creating its own.

**Files:**
- Modify: `packages/server/src/ingest/pipeline.ts`
- Modify: `packages/server/src/ingest/pipeline.test.ts`
- Modify: `packages/server/src/ingest/index.ts`

### Step 1: Write the failing test

Add to `packages/server/src/ingest/pipeline.test.ts`:

```typescript
it('accepts an existing DuckDBInstance instead of databaseUrl', async () => {
  const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
  const result = await runIngest({
    dbInstance: db,
    ddlPath: DDL_PATH,
    datDir: DAT_DIR,
    tables: ['status_code'],
  });
  expect(result.tablesLoaded).toHaveLength(1);
  expect(result.tablesLoaded[0]!.tableName).toBe('status_code');
});
```

### Step 2: Run test to verify it fails

Run: `cd packages/server && pnpm vitest run src/ingest/pipeline.test.ts`
Expected: FAIL — `dbInstance` is not a recognized option

### Step 3: Implement the dbInstance option

Modify `IngestOptions` in `packages/server/src/ingest/pipeline.ts`:

```typescript
export type IngestOptions = {
  /** Path to the DuckDB database file. Ignored if dbInstance is provided. */
  databaseUrl?: string | undefined;
  /** Existing DuckDB instance to use (e.g. from getDb()). Takes precedence over databaseUrl. */
  dbInstance?: DuckDBInstance | undefined;
  // ... rest unchanged
};
```

Modify the Stage 4 section of `runIngest()`:
```typescript
// Stage 4: Open DB connection
const db: DuckDBInstance = options.dbInstance
  ?? await DuckDBInstance.create(options.databaseUrl!);
const conn: DuckDBConnection = await DuckDBConn.create(db);
```

The connection is still closed at the end. If `dbInstance` was provided, the caller owns the instance lifecycle.

### Step 4: Run tests to verify they pass

Run: `cd packages/server && pnpm vitest run src/ingest/pipeline.test.ts`
Expected: PASS

### Step 5: Update exports if needed

Ensure `IngestOptions` type export in `index.ts` already covers the new field (it does, since it re-exports the type).

### Step 6: Run full test suite

Run: `make test`
Expected: All pass

### Step 7: Commit

```bash
git add packages/server/src/ingest/pipeline.ts packages/server/src/ingest/pipeline.test.ts
git commit -m "feat(ingest): accept existing DuckDBInstance for in-process use"
```

---

## Task 4: Update Documentation

**Files:**
- Modify: `doc/ingest.md`

### Step 1: Update doc/ingest.md

Add sections covering:
- The `--download` CLI flag and `make ingest-download`
- The ingest_log table and what gets recorded
- In-process usage example: `const db = await getDb(); await runIngest({ dbInstance: db, ... })`

### Step 2: Commit

```bash
git add doc/ingest.md
git commit -m "docs(ingest): document download, logging, and in-process usage"
```

---

## Task 5: Final Integration Test

### Step 1: Run full test suite

Run: `make test`
Expected: All pass

### Step 2: Merge and push

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```
