# ITC Filing Type Support

**Date:** 2026-03-26
**Status:** In Progress

## Context

The ICFS scraper currently monitors only SAT and SES subsystems. ITC (International Telecommunications Certificate) filings are not being scraped, despite being an active filing type — two ITC filings (`ITC-T/C-20260326-00086`, `ITC-RPT-20260326-00085`) were the only new filings on 2026-03-26.

The DB contains 15,125 ITC filings from the legacy IBFS bulk ingest, of which 128 are from the ICFS era (post-2025-06-24). However, October 2025 has zero ITC filings, suggesting gaps in the existing data.

### ITC Volume Profile

ITC averages ~15 filings/month, peaking at ~23.

### ITC App Types

Legacy data shows these ITC app types: `214` (9,587), `T/C` (3,352), `ASG` (1,397), `STA` (547), `MOD` (86), `TAO` (85), `AMD` (62), `NTC` (4), `MSC` (3), `WAV` (2). ICFS-era filings include `RPT` — a code not seen in legacy data.

## Approach: Per-Subsystem App Type Partitioning

**Update:** Live testing confirmed that broad queries (`ITC-YYYYMM`) return 0 results — the ICFS search API requires the app-type segment in the query (see `scraping-strategy.md` §3.3). ITC uses the same `SUB-APPTYPE-YYYYMM` pattern as SAT/SES, with its own list of 11 known app types.

If new ITC app types emerge, they must be added to `DEFAULT_SUBSYSTEM_APP_TYPES` in `pipeline.ts`.

## Implementation

### Phase 1: Discovery Changes (Done)

- [x] Add `buildDiscoveryQueriesFromMap()` to `discovery.ts` — generates queries from per-subsystem app type map
- [x] Add `SubsystemAppTypes` type and `DEFAULT_SUBSYSTEM_APP_TYPES` config with ITC app types
- [x] Replace `subsystems`/`appTypes`/`broadQuerySubsystems` options with single `subsystemAppTypes` map
- [x] Wire per-subsystem queries into `runIcfsIngest()` pipeline
- [x] Update CLI `--subsystems` and `--app-types` args to build override map
- [x] Unit tests for `buildDiscoveryQueriesFromMap()`
- [x] Update `doc/scraping-strategy.md` with corrected query model

### Phase 2: Survey Scrape

One-time backfill of all ICFS-era ITC filings to fill gaps (e.g., missing October 2025).

```bash
./daily-orbit ingest icfs \
  --date-from 2025-06 \
  --date-to 2026-03 \
  --subsystems ITC \
  --concurrency 10
```

This discovers all ITC filings from ICFS launch through today. The pipeline's `skipKnown` logic is not used here (full refresh mode), so existing filings get their detail data updated while new ones are inserted.

**Expected volume:** ~10 months × ~15 filings/month ≈ 150 filings. At 2s per detail fetch with concurrency 10, the survey completes in ~30 seconds.

### Phase 3: Validation

After the survey scrape, verify completeness:

```sql
-- Check for month gaps
SELECT strftime(date_filed, '%Y-%m') AS month, count(*) AS cnt
FROM filing
WHERE file_number LIKE 'ITC-%' AND date_filed >= '2025-06-01'
GROUP BY 1 ORDER BY 1;

-- Check for new app types discovered
SELECT DISTINCT
  substring(file_number, 5, position('-' IN substring(file_number, 5)) - 1) AS app_type
FROM filing
WHERE file_number LIKE 'ITC-%' AND date_filed >= '2025-06-24'
ORDER BY 1;

-- Confirm ICFS detail data is populated
SELECT icfs_sys_id IS NOT NULL AS has_detail, count(*)
FROM filing
WHERE file_number LIKE 'ITC-%' AND date_filed >= '2025-06-24'
GROUP BY 1;
```

Success criteria:
- No month gaps from 2025-06 through 2026-03
- All ICFS-era ITC filings have `icfs_sys_id` populated
- Any newly discovered app types are logged for awareness

## Query Matrix Impact

| Before | After |
|--------|-------|
| 2 subsystems × 9 app types × 2 months = **36 queries** | (2 × 9 × 2) + (1 × 11 × 2) = **58 queries** |

Modest increase in discovery time (~6 seconds vs ~4 seconds at concurrency 20).
