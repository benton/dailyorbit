# DuckDB Upsert Hang: Deep Dive Debugging Plan

## Problem Statement

`upsertBatch()` in `packages/server/src/ingest/loader.ts` hangs indefinitely when processing tables with >10k rows. The hang occurs on any SQL statement that reads from a table previously written to via the DuckDB Appender API in the same connection, including:

- `MERGE INTO` (original approach)
- `UPDATE ... FROM ... WHERE` (swap-and-reconcile approach)

Small tables (82 rows) complete instantly. The hang is reproducible on both in-memory and file-backed DuckDB.

### Why This Matters

Drop-and-reload is not viable long-term. The data model will grow to include per-user columns (viewing history, preferences) and application-added columns that reference these entities. We need correct upsert behavior that:

1. Preserves `_first_seen_at` for existing rows
2. Detects and timestamps modifications via `_modified_at`
3. Soft-deletes rows missing from new snapshots
4. Preserves any application-added data on existing rows

### What We Know

| Fact | Source |
|------|--------|
| Fresh `insertBatch` of 144k rows via Appender: **344ms** | debug-upsert.ts |
| `UPDATE` with JOIN on two 144k-row tables created *without* Appender: **1ms** | debug-upsert.ts Test 2 |
| `UPDATE` with JOIN where *either* table was written via Appender: **hangs** | debug-upsert.ts |
| Small tables (82 rows) via Appender + UPDATE: **works fine** | loader.test.ts |
| DuckDB version: `@duckdb/node-api` 1.5.0-r.1 | package.json |
| Node.js version: 24.14.0 | `node --version` |
| Platform: macOS Darwin 24.6.0 (Apple Silicon) | `uname -a` |

### Hypothesis

The Appender API in `@duckdb/node-api` 1.5.x does not fully flush/commit data in a way that allows subsequent SQL statements on the same connection to read the appended rows without blocking. This may be:

1. A missing `flush`/`sync` barrier between Appender close and subsequent SQL
2. A row-group locking issue where the Appender holds a read lock
3. A known bug in the Node.js bindings (not present in the C++ or Python APIs)
4. A transaction isolation issue specific to the Node.js async API

---

## Debugging Tasks

### Task 1: Search for Known Issues

**Goal:** Determine if this is a known bug with a fix or workaround.

**Steps:**

1. Web search: `duckdb node-api appender hang update site:github.com`
2. Web search: `duckdb appender flush commit node.js`
3. Web search: `@duckdb/node-api MERGE hang large table`
4. Search GitHub issues: `https://github.com/duckdb/duckdb-node-neo/issues` for "appender", "hang", "deadlock", "MERGE"
5. Search GitHub issues: `https://github.com/duckdb/duckdb/issues` for "appender update hang"
6. Check DuckDB docs for Appender lifecycle: flush vs close vs sync semantics
7. Check `@duckdb/node-api` changelog for 1.5.x for any Appender-related fixes
8. Check if there's a newer version of `@duckdb/node-api` beyond 1.5.0-r.1

**Record findings in:** `doc/plans/upsert-debug-findings.md`

### Task 2: Reproduce Minimally

**Goal:** Create the smallest possible reproduction case.

**File:** `scripts/debug-upsert-minimal.ts` (gitignored)

**Steps:**

1. Create a minimal table with 1 INTEGER PK column and 1 VARCHAR column
2. Insert N rows via Appender (start with N=100, increase to find threshold)
3. Attempt a simple `UPDATE table SET col = 'x'` (no JOIN)
4. If that works, try `UPDATE table SET col = 'x' WHERE pk IN (SELECT pk FROM other_table)`
5. Try `SELECT * FROM table` after Appender close — does SELECT hang too, or just UPDATE?
6. Try adding explicit transaction boundaries: `BEGIN`, Appender, `COMMIT`, then UPDATE
7. Try creating a **new connection** from the same DuckDBInstance for the UPDATE
8. Try `conn.run('CHECKPOINT')` after Appender close, before UPDATE
9. Find the exact row count threshold where it starts hanging

**Key questions to answer:**
- Does SELECT also hang, or only UPDATE/MERGE?
- Does a new connection from the same instance work?
- Does an explicit CHECKPOINT after Appender close unblock the UPDATE?
- Is there a row count threshold?

### Task 3: Test Connection Isolation Workaround

**Goal:** Determine if using a separate connection for the UPDATE phase fixes the hang.

**File:** `scripts/debug-upsert-two-conn.ts`

**Steps:**

1. Connection A: create table, insertBatch via Appender, close Appender
2. Connection B (from same DuckDBInstance): run UPDATE with JOIN
3. If this works, measure performance
4. If this works, implement in `upsertBatch()`:
   - Accept a `DuckDBInstance` parameter (or derive from connection)
   - Create a second connection for the reconciliation SQL
   - Close the second connection when done

### Task 4: Test CHECKPOINT Workaround

**Goal:** Determine if forcing a checkpoint after Appender close unblocks subsequent SQL.

**File:** `scripts/debug-upsert-checkpoint.ts`

**Steps:**

1. Create table, insertBatch via Appender, close Appender
2. Run `CHECKPOINT` on the connection
3. Run UPDATE with JOIN
4. Measure total time including checkpoint overhead

### Task 5: Test INSERT-based Alternative to UPDATE

**Goal:** If UPDATE hangs but INSERT doesn't, use INSERT...SELECT to build the reconciled table.

**File:** `scripts/debug-upsert-insert-select.ts`

**Steps:**

1. Load old data via Appender into `table`
2. Load new data via Appender into `table_staging`
3. Instead of UPDATE, build the final result via `CREATE TABLE table_final AS SELECT ...` using a JOIN that computes tracking columns
4. This avoids UPDATE entirely — test if INSERT...SELECT also hangs after Appender

### Task 6: Test Python/CLI DuckDB for Comparison

**Goal:** Determine if the bug is Node.js-specific.

**Steps:**

1. Create equivalent test in DuckDB CLI (`.sql` file):
   ```sql
   CREATE TABLE t (pk INTEGER, val VARCHAR, ts TIMESTAMP);
   -- Insert 200k rows
   INSERT INTO t SELECT i, 'val' || i, current_timestamp FROM range(200000) r(i);
   -- Try UPDATE
   UPDATE t SET ts = current_timestamp;
   ```
2. If CLI works fine, the bug is in the Node.js bindings
3. Try the same with the Python API if available

### Task 7: Implement the Fix

**Goal:** Based on findings from Tasks 1-6, implement a working upsert.

**Likely fixes (in order of preference):**

1. **CHECKPOINT after Appender** — if Task 4 succeeds, add `await conn.run('CHECKPOINT')` after `appender.closeSync()` in both `insertBatch` and `insertBatchInto`
2. **Two-connection approach** — if Task 3 succeeds, refactor `upsertBatch` to use a second connection for reconciliation SQL
3. **INSERT...SELECT instead of UPDATE** — if Task 5 succeeds, build final table via SELECT with JOIN rather than UPDATE
4. **Upgrade @duckdb/node-api** — if Task 1 finds a fix in a newer version
5. **Use parameterized INSERT instead of Appender** — fall back to batch INSERT statements for the staging table (slower but may not trigger the bug)

**After implementing:**
- Update `loader.test.ts` upsert tests
- Run full test suite: `make test`
- Run full ingest twice: `make ingest` × 2
- Verify row counts and tracking columns

### Task 8: Update Documentation

- Remove the "drop-and-reload" workaround from `loader.ts`
- Update `doc/ingest.md` with the fix and any caveats
- If using a workaround, document the upstream bug with a link to the GitHub issue

---

## Current State of the Code

The `upsertBatch()` function in `loader.ts` currently uses a **drop-and-reload** approach as a temporary workaround. This does NOT preserve `_first_seen_at`, soft-deleted rows, or any future application-added data. The existing upsert tests in `loader.test.ts` were written for the original MERGE approach and need updating once a real fix is in place.

**Files to modify:**
- `packages/server/src/ingest/loader.ts` — the upsert implementation
- `packages/server/src/ingest/loader.test.ts` — upsert tests
- `packages/server/src/ingest/pipeline.ts` — may need to pass DuckDBInstance to upsertBatch
- `doc/ingest.md` — document the fix

## Estimated Effort

Tasks 1-6 are research/debugging (~1 hour). Task 7 depends on findings. Task 8 is quick.
