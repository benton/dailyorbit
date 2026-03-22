# Test Rewind Command Design

## Overview

A CLI command and admin API that "reverses time" by removing recently ingested filings and all dependent rows from the database, enabling fast and cheap manual and automated testing of the monitoring and alerting pipeline.

Physical attachment files on disk are never touched — only database rows are affected.

---

## Command Interface

```
./daily-orbit test rewind --since 2026-03-18
./daily-orbit test rewind --last 50
./daily-orbit test rewind --since 2026-03-18 --full
./daily-orbit test rewind --dry-run --last 50
./daily-orbit test rewind --since 2026-03-18 --yes
```

| Flag             | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `--since <date>` | Remove filings with `_first_seen_at >= date`                           |
| `--last <n>`     | Remove the N most recently ingested filings (by `_first_seen_at` desc) |
| `--full`         | Also delete embeddings and rebuild FTS index (expensive to re-derive)  |
| `--dry-run`      | Print what would be deleted with counts per table, but don't execute   |
| `--yes`          | Skip confirmation prompt                                               |

`--since` and `--last` are mutually exclusive. One is required.

---

## Deletion Logic

### Target Set

```sql
-- --since mode
CREATE TEMP TABLE rewind_filings AS
  SELECT file_number, filing_key FROM filing WHERE _first_seen_at >= ?;

-- --last mode
CREATE TEMP TABLE rewind_filings AS
  SELECT file_number, filing_key FROM filing
  ORDER BY _first_seen_at DESC LIMIT ?;
```

### Deletion Order (FK-safe)

Executed in a single transaction:

| Step | Table               | Condition                                                                     | Default | `--full` only |
| ---- | ------------------- | ----------------------------------------------------------------------------- | ------- | ------------- |
| 1    | `alert_run`         | all rows (resets watermarks)                                                  | x       |               |
| 2    | `user_content_flag` | `content_type='filing' AND content_key IN (file_numbers)`                     | x       |               |
| 3    | `user_filing_view`  | `file_number IN (file_numbers)`                                               | x       |               |
| 4    | `pleading`          | `filing_key IN (filing_keys)`                                                 | x       |               |
| 5    | `attachment`        | `filing_key IN (filing_keys)`                                                 | x       |               |
| 6    | `filing`            | target set                                                                    | x       |               |
| 7    | `embedding`         | `source_table IN ('filing','attachment','pleading') AND source_key IN (keys)` |         | x             |
| 8    | FTS rebuild         | `PRAGMA create_fts_index(...)` with overwrite                                 |         | x             |

### Cost Rationale

- **Default mode** is fast and exercises the full monitoring/alerting pipeline. Re-ingest will re-discover filings, re-insert rows, and re-extract text (local, cheap). Summaries and embeddings will be absent but are not needed for alert evaluation.
- **`--full` mode** triggers the expensive operations on re-ingest: LLM summarization (Bedrock), vector embedding (Bedrock Titan V2), and FTS index rebuild (local but slow).

---

## Output Format

### Dry Run

```
$ ./daily-orbit test rewind --since 2026-03-19 --dry-run

Rewind scope: filings with _first_seen_at >= 2026-03-19

  Table                Rows to delete
  -------------------  --------------
  filing                          127
  attachment                      843
  pleading                         31
  user_filing_view                 54
  user_content_flag                12
  alert_run                         3

  --full would also delete:
  embedding                     1,204
  FTS index                   rebuild

Dry run - no changes made.
```

### Execution

```
$ ./daily-orbit test rewind --since 2026-03-19

Rewind scope: filings with _first_seen_at >= 2026-03-19

  Table                Rows to delete
  -------------------  --------------
  filing                          127
  attachment                      843
  pleading                         31
  user_filing_view                 54
  user_content_flag                12
  alert_run                         3

Proceed? [y/N] y

Deleting...
  alert_run:           3 deleted
  user_content_flag:  12 deleted
  user_filing_view:   54 deleted
  pleading:           31 deleted
  attachment:        843 deleted
  filing:            127 deleted

Done. Run './daily-orbit ingest ibfs' to re-ingest.
```

### Full Mode

Adds to the execution output:

```
  embedding:       1,204 deleted
  FTS index:       rebuilt (3.2s)

Done. Run './daily-orbit ingest ibfs' to re-ingest (will re-extract, re-summarize, and re-embed).
```

---

## File Locations

| File                                       | Purpose                                  |
| ------------------------------------------ | ---------------------------------------- |
| `packages/server/src/cli/test/index.ts`    | `test` subcommand group                  |
| `packages/server/src/cli/test/rewind.ts`   | CLI command definition                   |
| `packages/server/src/test-utils/rewind.ts` | Core rewind logic (testable without CLI) |

Core logic is separated from the CLI so it can be called from integration tests and the admin API.

---

## Admin API

The rewind operation is also exposed via admin API routes, enabling browser-based testing with Playwright while the app is running (and the DB is locked by the API server).

### Endpoints

| Method | Path                            | Description                            |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/admin/test/rewind/plan`   | Dry-run: returns per-table counts      |
| POST   | `/api/admin/test/rewind/execute`| Execute the rewind deletion            |

Both endpoints accept the same JSON body:

```json
{
  "since": "2026-03-20",  // or omit
  "last": 20,             // mutually exclusive with since
  "full": false           // optional, default false
}
```

Response shape matches `RewindResult`:

```json
{
  "scope": "20 most recently ingested filings",
  "counts": [
    { "table": "filing", "count": 20 },
    { "table": "attachment", "count": 143 },
    ...
  ],
  "fullCounts": [
    { "table": "embedding", "count": 0 },
    { "table": "FTS index", "count": "rebuild" }
  ]
}
```

### File Locations

| File                                            | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `packages/server/src/cli/test/index.ts`         | `test` subcommand group                  |
| `packages/server/src/cli/test/rewind.ts`        | CLI command definition                   |
| `packages/server/src/test-utils/rewind.ts`      | Core rewind logic (testable without CLI) |
| `packages/server/src/test-utils/routes.ts`      | Admin API routes for rewind              |

---

## Test Scenarios (Playwright-Automated)

These scenarios use the Playwright MCP server to drive the admin UI and verify the monitoring/alerting pipeline. Each scenario builds on the previous one and tests a distinct code path.

All scenarios assume the dev servers are running (`make dev`) and the user is logged in as an admin.

### Prerequisites

- Dev servers running (`make dev`)
- Admin user logged in via Playwright browser session
- At least one saved search exists with `alert_enabled=true` (e.g. "SpaceX SAT filings")
- The database has filings that match the saved search criteria
- AWS_PROFILE is configured for SES email delivery (for scenario 2)

### Scenario 1: Alert Flag Creation (No Email)

**Goal:** Verify that alert evaluation discovers re-ingested filings and creates content flags.

**Playwright Steps:**

1. Navigate to `/admin` settings and ensure email alerts are disabled for the test user
2. Call `POST /api/admin/test/rewind/plan` with `{ "last": 20 }` — note the counts
3. Call `POST /api/admin/test/rewind/execute` with `{ "last": 20 }` — verify 20 filings removed
4. Navigate to the Admin Pipeline page
5. Trigger the `ibfs.ingest` pipeline stage from the UI — wait for completion via SSE logs
6. Trigger the `alerts.evaluate` pipeline stage from the UI — wait for completion
7. **Check via API:** `GET /api/user/alerts/flagged` returns items with:
   - `source = 'alert'`
   - `content_key` values matching re-ingested filing file numbers
8. **Check via API:** `GET /api/user/alerts/unread-count` returns count > 0

### Scenario 2: Alert Email Delivery

**Goal:** Verify that alert evaluation sends an email digest when the user has opted in.

**Playwright Steps:**

1. Navigate to user settings and enable email alerts (`email_daily_orbit = true`)
2. Call `POST /api/admin/test/rewind/execute` with `{ "last": 20 }`
3. Trigger `ibfs.ingest` from the pipeline UI — wait for completion
4. Trigger `alerts.evaluate` from the pipeline UI — wait for completion
5. **Check via API:** `GET /api/user/alerts/flagged` — items should have `emailed_at` set
6. **Check inbox:** Email arrives at benton@bentonroberts.com with:
   - Subject containing "new items matching your alerts"
   - Body lists the saved search name and matching filings
   - Filing links point to the correct `/filings/:file_number` URLs

### Scenario 3: Watermark-Based Deduplication

**Goal:** Verify that running alert evaluation a second time does not re-flag or re-email already-processed filings.

**Playwright Steps:**

1. Complete scenario 1 or 2 (flags exist from a prior evaluation)
2. Note the current flag count via `GET /api/user/alerts/unread-count`
3. Trigger `alerts.evaluate` from the pipeline UI again — **without** rewinding
4. **Check:** `GET /api/user/alerts/unread-count` returns same count (no new flags)
5. **Check:** No new email is sent (if email was enabled)

**Why this works:** The evaluator uses the previous `alert_run.executed_at` as the watermark. Since no filings have `_first_seen_at` after that timestamp, zero results are returned.

### Scenario 4: UI Integration

**Goal:** Verify that alert flags are correctly surfaced in the web UI.

**Prerequisites:** Complete scenario 1 (active flags exist in the database).

**Playwright Steps:**

1. Navigate to the app home page
2. **Nav bar badge:** Take a snapshot and verify the alert count badge shows unread flagged items > 0
3. **Alerts page:** Navigate to `/alerts` and verify:
   - Flagged filings appear grouped by saved search name
   - Each item shows file number, applicant, date filed
   - Items link to the correct filing detail page
4. **Dismiss a flag:** Click dismiss on one flagged item and verify:
   - The item disappears from the active list
   - The nav bar badge count decrements by 1
5. **Filing detail page:** Click through to a flagged filing's detail page and verify:
   - The flag indicator is visible
   - Wait ~12 seconds, then verify the filing is marked as read (view count changes)
   - Navigate back to `/alerts` — the item still appears (flags are independent of view status)
6. **Badge polling:** Wait 60 seconds, take a snapshot, and verify the badge count refreshed
