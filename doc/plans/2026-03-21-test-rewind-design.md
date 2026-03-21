# Test Rewind Command Design

## Overview

A CLI command that "reverses time" by removing recently ingested filings and all dependent rows from the database, enabling fast and cheap manual (and eventually automated) testing of the monitoring and alerting pipeline.

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

| Flag | Description |
|------|-------------|
| `--since <date>` | Remove filings with `_first_seen_at >= date` |
| `--last <n>` | Remove the N most recently ingested filings (by `_first_seen_at` desc) |
| `--full` | Also delete embeddings and rebuild FTS index (expensive to re-derive) |
| `--dry-run` | Print what would be deleted with counts per table, but don't execute |
| `--yes` | Skip confirmation prompt |

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

| Step | Table | Condition | Default | `--full` only |
|------|-------|-----------|---------|---------------|
| 1 | `alert_run` | all rows (resets watermarks) | x | |
| 2 | `user_content_flag` | `content_type='filing' AND content_key IN (file_numbers)` | x | |
| 3 | `user_filing_view` | `file_number IN (file_numbers)` | x | |
| 4 | `pleading` | `filing_key IN (filing_keys)` | x | |
| 5 | `attachment` | `filing_key IN (filing_keys)` | x | |
| 6 | `filing` | target set | x | |
| 7 | `embedding` | `source_table IN ('filing','attachment','pleading') AND source_key IN (keys)` | | x |
| 8 | FTS rebuild | `PRAGMA create_fts_index(...)` with overwrite | | x |

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

| File | Purpose |
|------|---------|
| `packages/server/src/cli/test/index.ts` | `test` subcommand group |
| `packages/server/src/cli/test/rewind.ts` | CLI command definition |
| `packages/server/src/test-utils/rewind.ts` | Core rewind logic (testable without CLI) |

Core logic is separated from the CLI so it can be called from integration tests later.

---

## Test Scenarios

These scenarios document how to use the rewind command to exercise the monitoring and alerting pipeline. Each scenario builds on the previous one and tests a distinct code path.

### Prerequisites

- A user account exists in the database
- At least one saved search exists with `alert_enabled=true` (e.g. "SpaceX SAT filings")
- The database has filings that match the saved search criteria
- AWS_PROFILE is configured for SES email delivery (for scenario 2)

### Scenario 1: Alert Flag Creation (No Email)

**Goal:** Verify that alert evaluation discovers re-ingested filings and creates content flags.

**Steps:**

1. Ensure `user_settings.email_daily_orbit = false` for the test user
2. Note the current count of `user_content_flag` rows for reference
3. Run: `./daily-orbit test rewind --last 20`
4. Verify: 20 filings removed, all `alert_run` rows cleared
5. Run: `./daily-orbit ingest ibfs` — re-discovers the 20 filings as new (`_first_seen_at` = now)
6. Run: `./daily-orbit pipeline run alerts.evaluate`
7. **Check:** `user_content_flag` rows exist with:
   - `source = 'alert'`
   - Correct `saved_search_id` matching the enabled search
   - `content_key` values are file numbers of matching re-ingested filings
   - `emailed_at IS NULL`
   - `dismissed_at IS NULL`
8. **Check:** `alert_run` row exists with `items_matched > 0`, `items_flagged > 0`, `email_sent = false`

### Scenario 2: Alert Email Delivery

**Goal:** Verify that alert evaluation sends an email digest when the user has opted in.

**Steps:**

1. Set `user_settings.email_daily_orbit = true` for the test user (benton@bentonroberts.com)
2. Run: `./daily-orbit test rewind --last 20`
3. Run: `./daily-orbit ingest ibfs`
4. Run: `./daily-orbit pipeline run alerts.evaluate`
5. **Check:** `user_content_flag` rows have `emailed_at IS NOT NULL`
6. **Check:** `alert_run` row has `email_sent = true`
7. **Check:** Email arrives at benton@bentonroberts.com with:
   - Subject: "Daily Orbit: N new items matching your alerts"
   - Body lists the saved search name and matching filings
   - Filing links point to the correct `/filings/:file_number` URLs

### Scenario 3: Watermark-Based Deduplication

**Goal:** Verify that running alert evaluation a second time does not re-flag or re-email already-processed filings.

**Steps:**

1. Complete scenario 1 or 2 (flags exist from a prior evaluation)
2. Run: `./daily-orbit pipeline run alerts.evaluate` again — **without** rewinding
3. **Check:** No new `user_content_flag` rows are created
4. **Check:** New `alert_run` row exists with `items_matched = 0`, `items_flagged = 0`
5. **Check:** No email is sent (if email was enabled)

**Why this works:** The evaluator uses the previous `alert_run.executed_at` as the watermark. Since no filings have `_first_seen_at` after that timestamp, zero results are returned.

### Scenario 4: UI Integration

**Goal:** Verify that alert flags are correctly surfaced in the web UI.

**Prerequisites:** Complete scenario 1 (active flags exist in the database). Start the dev servers with `make dev`.

**Steps:**

1. Open the app in a browser and log in
2. **Nav bar badge:** Verify the alert count badge shows the correct number of unread flagged items
3. **Alerts page (`/alerts`):** Navigate to the alerts page and verify:
   - Flagged filings appear grouped by saved search name
   - Each item shows file number, applicant, date filed
   - Items link to the correct filing detail page
4. **Dismiss a flag:** Click dismiss on one flagged item and verify:
   - The item disappears from the active list
   - The nav bar badge count decrements by 1
   - The `user_content_flag` row has `dismissed_at IS NOT NULL`
5. **Filing detail page:** Navigate to a flagged filing's detail page and verify:
   - The flag indicator is visible
   - After ~10 seconds, the filing is marked as read (`user_filing_view` row created)
   - Returning to `/alerts`, the item still appears (flags are independent of view status)
6. **Badge polling:** Wait 60 seconds and verify the badge count refreshes (polls `/api/user/alerts/unread-count`)
