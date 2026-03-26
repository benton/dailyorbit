# ICFS Scraping Strategy

How Daily Orbit discovers and ingests filings from the FCC's ICFS portal, and the constraints that shape its approach.

---

## 1. The ICFS Portal

The FCC replaced its legacy IBFS system with ICFS on 2025-06-24. ICFS runs on ServiceNow Government Cloud at `https://fccprod.servicenowservices.com`. It is the **sole source** of new filing data — the legacy IBFS FTP archive and fcc.report mirror are both frozen.

---

## 2. What Works

Two unauthenticated JSON API endpoints are available:

### 2.1. Search API

`POST /api/now/sp/search` accepts a free-text query string and returns matching filing records. Each response includes `sys_id`, file number (the `label` field), applicant name, and subsystem. Results come in two arrays (`results` and `additionalResults`) that must be merged.

### 2.2. Filing Detail API

`GET /api/now/sp/page?id=ibfs_application_summary&number={fileNumber}` returns a complete filing record: 41 metadata fields, attachment metadata with download links, and pleading/comment entries. This endpoint is unauthenticated and reliable.

---

## 3. What Doesn't Work

### 3.1. No "New Filings" Feed

There is no RSS feed, Atom feed, public notice listing, or "recently filed" endpoint. The FCC International Bureau RSS feed at `transition.fcc.gov/rss/bureau/international.xml` is dead (404). The ICFS `ibfs-search-pns` source returns public notice report numbers (e.g., `SAT-01985`) but their detail pages require authentication — they are not usable for change detection.

### 3.2. No Table API Access

The ServiceNow Table API (`/api/now/table/x_fmc_ibfs_base_table`) returns 401 for all unauthenticated requests, including aggregate queries (`/api/now/stats/...`). There is no way to ask "what changed since timestamp X" or "how many total filings exist."

### 3.3. Queries Require Subsystem + App Type

The search engine matches query strings against file number text. Queries **must** include both the subsystem and application type prefix to produce results:

| Query | Results | Notes |
|-------|---------|-------|
| `SAT-LOA-202603` | 5 | Works — matches file number prefix |
| `SAT-202603` | 0 | Fails — no file numbers contain this substring |
| `ITC-202603` | 0 | Fails — same reason (file numbers have app type between subsystem and date) |
| `ITC-214-202603` | 15 | Works — matches file number prefix |
| `202603` | 561 | Matches date portion across all subsystems, but hits the 200 result cap |

The query `SUB-APPTYPE-YYYYMM` is the only reliable, partition-safe pattern. This applies to all subsystems, including low-volume ones like ITC.

### 3.4. Result Cap at 200

The API returns at most 200 results per query. The `count` parameter is accepted but the server enforces a hard cap. Pagination parameters (`start`, `offset`) are accepted but have no effect — the same 200 results are returned regardless of offset. Any query that matches more than 200 filings silently truncates.

### 3.5. No Conditional Requests

The search API does not support `ETag`, `If-Modified-Since`, or any other conditional request mechanism. Every request returns the full result set. There is no way to ask "has anything changed since my last request."

### 3.6. Slow Response Times

Every search query takes approximately **2 seconds** regardless of result count (0 results or 200 results). This is a ServiceNow platform characteristic, not a network issue. The filing detail endpoint is similarly slow at ~2 seconds per request.

### 3.7. Authenticated Endpoints

Most ICFS portal pages redirect to Okta SSO (`fcc-ext.okta.com`). Attachment downloads (`/sys_attachment.do?sys_id=...`) require an authenticated session. The search and filing detail endpoints are the only two that work without authentication.

---

## 4. Discovery Strategy

Given these constraints, filing discovery uses a **month-partitioned query matrix**:

### 4.1. Query Matrix

For each combination of (subsystem, application type, month), issue a search query:

Each subsystem has its own app-type list, all queried as `SUB-APPTYPE-YYYYMM`:

- **SAT, SES:** LOA, MOD, STA, AMD, T/C, ASG, LIC, RWL, REG (9 types each)
- **ITC:** 214, T/C, ASG, STA, MOD, TAO, AMD, NTC, MSC, WAV, RPT (11 types)
- **Month window:** Current month and previous month

This produces **(2 × 9 × 2) + (1 × 11 × 2) = 58 queries** per discovery run. At concurrency 20, discovery completes in approximately **6 seconds**.

### 4.1.1. ITC App Types

ITC app types were derived from legacy IBFS data (10 types) plus `RPT`, an ICFS-era code not present in legacy data. If new ITC app types appear, they must be added to the configuration. This is a tradeoff: the ICFS search API requires the app-type prefix (see §3.3), so there is no way to discover unknown app types via broad queries.

### 4.2. Why This Partitioning

The partitioning is driven by the 200-result cap. Recent months for SAT and SES individually produce well under 200 results per app type, so no truncation occurs. The month-only query `202603` returns 387 results (truncated to 200), proving that broader queries are unsafe.

If a partition ever exceeds 200 results (unlikely for a single subsystem × app type × month), the correct response is to split the month into smaller date ranges.

### 4.3. New Filing Detection

After discovery, the set of discovered file numbers is compared against the database. File numbers already present in the `filing` table are "known"; the remainder are "new." Only new filings require a detail fetch.

---

## 5. Two-Tier Refresh Model

The pipeline operates in two modes with different cadences:

### 5.1. Fast Probe (every ~1 minute)

**Goal:** Detect new filings as quickly as possible.

1. Run the 58 discovery queries (~4 seconds)
2. Compare discovered file numbers against the database
3. If no new file numbers: **stop immediately** (~5 seconds total)
4. If new file numbers found: fetch details for **only the new filings**, then run the downstream pipeline

This mode never re-fetches details for existing filings. Its purpose is pure change detection.

### 5.2. Full Refresh (every ~15 minutes)

**Goal:** Catch status updates, new attachments, and metadata changes on existing filings.

1. Run the 58 discovery queries
2. Fetch details for **all discovered filings** (the full 2-month window)
3. Upsert all records, updating any changed fields
4. Run the complete downstream pipeline

This is the existing pipeline behavior, just scheduled less frequently.

### 5.3. Why Two Tiers

Re-fetching detail for every known filing in the 2-month window costs hundreds of API calls at 2 seconds each. Doing this every minute is wasteful when the vast majority of runs discover nothing new. The fast probe isolates the change-detection cost (4 seconds) from the refresh cost (minutes), enabling near-real-time alerting without hammering the ICFS API.

---

## 6. Multi-Stage Alerting

When the fast probe discovers new filings, alerts are evaluated at three points in the downstream pipeline:

1. **After ICFS ingest** — Metadata-based saved searches fire immediately (e.g., "new SAT-LOA from SpaceX"). Latency: seconds after discovery.
2. **After FTS index rebuild** — Keyword-based saved searches fire (e.g., "filings mentioning Ka-band"). Latency: depends on text extraction.
3. **After embedding** — Semantic/concept-based saved searches fire. Latency: depends on embedding generation.

The alert evaluator's existing deduplication logic (`getEmailedContentKeys`) ensures no item generates an alert more than once, even when evaluated at multiple pipeline stages.

---

## 7. Future Considerations

### 7.1. Additional Subsystems

The current strategy monitors SAT, SES, and ITC, each with their own app-type list. Adding a new subsystem requires adding an entry to `DEFAULT_SUBSYSTEM_APP_TYPES` in `pipeline.ts` with the subsystem's known app types.

### 7.2. ICFS API Changes

ServiceNow portals are configurable. The FCC could enable table API access, add pagination, or expose an RSS feed at any time. Any of these would dramatically simplify change detection. The strategy should be revisited if the API surface changes.

### 7.3. Authenticated Scraping

With an authenticated session (obtained via headless Okta login), additional data sources become available: the table API with sorting/filtering, public notice details, and direct attachment downloads. An authenticated fast probe could potentially use `sysparm_order_by=-sys_created_on` to get the most recently created filings in a single request.
