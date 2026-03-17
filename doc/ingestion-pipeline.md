# Data Ingestion & Enhancement Pipeline

> **Maintainer note:** Update this document whenever pipeline steps are added, removed, or reordered.

## Overview

Daily Orbit maintains a multi-stage pipeline that transforms raw FCC filing data into an enriched, company-attributed, searchable dataset. The pipeline draws from two primary government data sources (IBFS legacy and ICFS live), discovers and downloads binary attachments, extracts full text from PDF, HTML, text, and CSV attachments, generates LLM-powered summaries of attachment text via AWS Bedrock, attributes filings to canonical company entities, extracts ownership-change events, and enriches company records from external registries.

All pipeline stages are **idempotent** and designed to run nightly.

---

## Pipeline Diagram

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 40, 'rankSpacing': 80, 'subGraphTitleMargin': {'top': 10, 'bottom': 10}}}}%%
flowchart TD
    subgraph sources["Data Sources"]
        IBFS["IBFS Legacy Bulk Export\n(FTP .dat files, frozen 2025-06-24)"]
        ICFS["ICFS ServiceNow API\n(Live filings, REST)"]
        FCC_PAGES["FCC Filing Web Pages\n(Attachment HTML)"]
        BEDROCK["AWS Bedrock\n(LLM inference)"]
        GLEIF["GLEIF LEI API\n(Legal Entity Identifiers)"]
        WIKIDATA["Wikidata SPARQL\n(Corporate metadata)"]
    end

    subgraph ingest["Stage 1 — Filing Ingest"]
        IBFS_INGEST["1a. IBFS Ingest\n./daily-orbit ingest ibfs\nParse .dat → normalize → deduplicate → load"]
        ICFS_INGEST["1b. ICFS Ingest\n./daily-orbit ingest icfs\nDiscover → fetch detail → upsert + auto-attribute"]
    end

    subgraph attachments["Stage 2 — Attachment Pipeline"]
        ATT_DISCOVER["2a. Attachment Discovery\n./daily-orbit attachments discover\nScrape filing pages → extract URLs"]
        ATT_DOWNLOAD["2b. Attachment Download (public)\n./daily-orbit attachments download\nDownload pending → detect type → store on disk"]
        ATT_AUTH["2b′. Authenticated Download\n./daily-orbit attachments download --auth-cookies\nServiceNow URLs via session cookies"]
        ATT_EXTRACT["2c. Text Extraction\n./daily-orbit attachments extract\nPDF/HTML/text/CSV → full text"]
        ATT_SUMMARIZE["2d. Summarization\n./daily-orbit inference summarize\nExtracted text → LLM summary via Bedrock"]
        FTS_REBUILD["2e. FTS Index Rebuild\n./daily-orbit search rebuild-index\nBM25 indexes on filing + attachment + pleading"]
    end

    subgraph company["Stage 3 — Company Attribution"]
        SEED["3a. Seed Companies\n./daily-orbit companies seed\nLoad ~30 companies + 100+ aliases"]
        ATTRIBUTE["3b. Batch Attribution\n./daily-orbit companies attribute\nExact → ILIKE → Prefix → FRN clustering"]
    end

    subgraph ownership["Stage 4 — Ownership Extraction"]
        EXTRACT["4. Extract Ownership Events\n./daily-orbit companies extract-ownership\nParse T/C + ASG filings → match parties"]
    end

    subgraph enrichment["Stage 5 — External Enrichment"]
        ENRICH["5. Company Enrichment\n./daily-orbit companies enrich\nGLEIF LEI + Wikidata metadata"]
    end

    subgraph storage["Persistence"]
        DB[("DuckDB\ndata/daily-orbit.duckdb\n\nfiling · attachment · company\ncompany_alias · ownership_event")]
        DISK["Attachment Files\ndata/attachments/"]
    end

    IBFS --> IBFS_INGEST
    ICFS --> ICFS_INGEST
    IBFS_INGEST --> DB
    ICFS_INGEST --> DB

    FCC_PAGES --> ATT_DISCOVER
    DB --> ATT_DISCOVER
    ATT_DISCOVER --> DB
    ATT_DOWNLOAD --> DB
    ATT_DOWNLOAD --> DISK
    ATT_AUTH --> DB
    ATT_AUTH --> DISK
    DISK --> ATT_EXTRACT
    ATT_EXTRACT --> DB
    DB --> ATT_SUMMARIZE
    BEDROCK --> ATT_SUMMARIZE
    ATT_SUMMARIZE --> DB
    DB --> FTS_REBUILD
    FTS_REBUILD --> DB

    SEED --> DB
    DB --> ATTRIBUTE
    ATTRIBUTE --> DB

    DB --> EXTRACT
    EXTRACT --> DB

    GLEIF --> ENRICH
    WIKIDATA --> ENRICH
    DB --> ENRICH
    ENRICH --> DB
```

---

## Stage 1 — Filing Ingest

### 1a. IBFS Legacy Bulk Ingest

| | |
|---|---|
| **Command** | `make ingest` or `make ingest-download` |
| **CLI** | `./daily-orbit ingest ibfs [--download] [--dry-run]` |
| **Source** | `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip` |
| **Status** | **Frozen** — FCC replaced IBFS with ICFS on 2025-06-24 |
| **Writes to** | `filing` table + related lookup tables |

**Flow:**

1. (Optional) Download and extract `IBFS.zip` → `tmp/IBFS/`
2. Parse Sybase DDL schema from `tmp/ibfs-schema.txt`
3. For each table with a `.dat` file:
   - Parse binary records using `dat-parser.ts`
   - Normalize file numbers to canonical format (`SUB-TYPE-YYYYMMDD-NNNNN`)
   - Deduplicate rows by primary key (keep latest)
4. First load: CREATE TABLE + fast Appender bulk insert
   Subsequent loads: staging table + MERGE upsert
5. Record unknown columns in `unknown_columns` table
6. Log run in `ingest_log` table

**Key options:** `--tables` (filter), `--dry-run` (parse-only), `--download` (fetch from FTP first)

---

### 1b. ICFS New Filing Ingest

| | |
|---|---|
| **Command** | `make icfs-ingest DATE_FROM=YYYY-MM` |
| **CLI** | `./daily-orbit ingest icfs --date-from YYYY-MM [--date-to YYYY-MM]` |
| **Source** | FCC ICFS ServiceNow REST API |
| **Default scope** | Subsystems: SAT, SES; App types: LOA, MOD, STA, AMD, T/C, ASG, LIC, RWL, REG |
| **Writes to** | `filing` table (upsert), sets `company_id` via auto-attribution |

**Two discovery modes:**

- **Date-range** (default): Generate queries `{SUBSYS}-{APPTYPE}-{YYYYMM}` for each month in range, search ServiceNow, collect file numbers, then fetch details
- **Direct file numbers**: `--file-numbers SAT-LOA-20250221-00050,...` skips discovery

**Per-filing flow:**

1. Fetch `IcfsFilingDetail` from ServiceNow (summary, transfer parties, service types, attachments, pleadings)
2. Upsert into `filing`:
   - Existing row → update ICFS-sourced columns only (preserves IBFS data)
   - New row → insert with legacy key or synthetic hash
3. Auto-attribute to company via `attributeFiling()` (same 3-tier logic as batch)

**Key options:** `--subsystems`, `--app-types`, `--delay` (default 500ms), `--concurrency` (default 4)

---

## Stage 2 — Attachment Pipeline

### 2a. Attachment Discovery

| | |
|---|---|
| **Command** | `make attachments-discover` |
| **CLI** | `./daily-orbit attachments discover [OPTIONS]` |
| **Source** | FCC legacy report HTML pages |
| **Writes to** | `attachment` table (metadata rows with `download_status = 'pending'`) |

**Flow:**

1. Query `filing` table for filings matching scope filters
2. For each un-scraped (or stale) filing:
   - Scrape FCC filing page HTML
   - Extract attachment metadata from Attachments table and Files table
3. Upsert attachment rows (deduplicated by `attachment_key`)
4. Mark filing as discovered with timestamp

**Key options:** `--filing`, `--subsystem`, `--date-from`, `--date-to`, `--limit`, `--stale-after`

### 2b. Attachment Download (public)

| | |
|---|---|
| **Command** | `make attachments-download` |
| **CLI** | `./daily-orbit attachments download [OPTIONS]` |
| **Source** | FCC download URLs stored in `attachment` table |
| **Writes to** | `data/attachments/{subsystem}/{file_number}/` + updates `attachment` table |

**Flow:**

1. Query pending attachments (`download_status = 'pending'` or `'failed'` with `--retry-failed`)
2. Pre-flight: check if file already on disk → reconcile DB without re-downloading
3. Download to temp path → detect content type → rename with correct extension
4. Update DB: `local_path`, `file_size_bytes`, `content_type`, `downloaded_at`, `download_status`

**Combined command:** `make attachments` runs discover + download + text extraction in one pass.

### 2b′. Authenticated Attachment Download (ServiceNow)

Attachments hosted at `fccprod.servicenowservices.com` require FCC Okta SSO
authentication. The pipeline supports a semi-automated workflow: a human logs
in once via browser, session cookies are extracted, and the download pipeline
uses those cookies to fetch ServiceNow-hosted attachments.

#### One-time setup

Install the Playwright browser used for cookie extraction:

```bash
pnpx playwright install chromium
```

#### Cookie extraction

| | |
|---|---|
| **Command** | `make attachments-extract-cookies` |
| **CLI** | `./daily-orbit attachments extract-cookies [--output PATH]` |
| **Output** | `data/icfs-cookies.json` |

The command opens a Chromium browser to the ICFS login page. The operator
completes SSO login (email + password + 2FA if prompted), then returns to
the terminal and presses **Enter**. The CLI extracts all ServiceNow session
cookies from the browser and writes them to a JSON file.

#### Authenticated download

| | |
|---|---|
| **Command** | `make attachments-download-auth` |
| **CLI** | `./daily-orbit attachments download --auth-cookies data/icfs-cookies.json --retry-failed` |
| **Source** | `attachment` rows where `download_url LIKE '%servicenowservices.com%'` |
| **Writes to** | `data/attachments/{subsystem}/{file_number}/` + updates `attachment` table |

When `--auth-cookies` is provided, the pipeline:

- Filters to only ServiceNow-hosted attachment URLs
- Sends the session cookie with each download request
- Does **not** follow HTTP redirects (a 302 means the session expired)
- On session expiry, stops gracefully and logs the count of successful
  downloads — remaining attachments stay `pending` for the next run
- Skips the `.pdf` URL suffix normalization used for fcc.report URLs

**Session lifetime:** ServiceNow sessions expire after roughly 30 minutes
(governed by the `glide_session_store` cookie). For daily operations this is
more than enough — a typical day's new filings produce only a handful of
attachments. If a large backlog run outlasts the session, re-extract cookies
and re-run; the pipeline picks up where it left off.

#### Daily procedure

```bash
# 1. Extract cookies (opens browser — log in, then press Enter)
make attachments-extract-cookies

# 2. Download authenticated attachments
make attachments-download-auth

# 3. Extract text from newly downloaded PDFs
make attachments-extract
```

### 2c. Text Extraction

| | |
|---|---|
| **Command** | `make attachments-extract` |
| **CLI** | `./daily-orbit attachments extract [OPTIONS]` |
| **Source** | Downloaded files in `data/attachments/` (PDF, text, CSV, HTML) |
| **Writes to** | `attachment` table: `full_text`, `text_length`, `extract_status` |

**Supported content types:**

| Content Type | Method | Notes |
|---|---|---|
| `application/pdf` | `pdf-oxide-wasm` (WASM), fallback to `pdftotext` (poppler) | Per-page markdown with heading detection |
| `text/plain` | Direct UTF-8 read | Minimum 10 non-whitespace chars |
| `text/csv` | Direct UTF-8 read | Same threshold as plain text |
| `text/html` | `node-html-parser` DOM parse → text extraction | Strips script/style/noscript; auth-failure stubs detected and skipped |

**Flow:**

1. Query attachments where `download_status = 'downloaded'`, `content_type IN ('application/pdf', 'text/plain', 'text/csv', 'text/html')`, and `extract_status = 'pending'`
2. Dispatch by content type:
   - **PDF** — read bytes, extract per-page markdown via `pdf-oxide-wasm`
   - **Text/CSV** — read as UTF-8 text
   - **HTML** — check for auth-failure stub (< 500 bytes + error pattern), then parse DOM and extract text
3. Classify result:
   - **extracted** — ≥ 50 non-whitespace chars (PDF/HTML) or ≥ 10 chars (text/CSV) → store `full_text` + `text_length`
   - **skipped_no_text** — below threshold (scanned/image-only PDF, empty HTML) → mark skipped
   - **skipped_auth_error** — HTML auth-failure stub (download error page) → mark skipped for potential re-download
   - **failed** — parse error or file not found → mark failed
4. Progress bar shown on stderr

**Key options:** `--limit`, `--retry-failed`, `--verbose`

### 2d. Summarization

| | |
|---|---|
| **Command** | `make summarize` or via `./daily-orbit attachments sync` |
| **CLI** | `./daily-orbit inference summarize [OPTIONS]` |
| **Source** | `attachment` table (rows where `full_text IS NOT NULL AND summary IS NULL`) |
| **Writes to** | `attachment.summary` |

**Flow:**

1. Query attachments with extracted text but no summary, joined with `filing` for metadata
2. For each attachment, render a Mustache prompt template with filing context variables (`fileNumber`, `applicantName`, `dateFiled`, `appTypeCode`, `subsystemCode`, `attachmentName`, `fullText`, `companyName`)
3. Send to AWS Bedrock via the app's `InferenceService` abstraction
4. Write the LLM-generated summary back to `attachment.summary`

**Integration:** Summarization also runs as Stage 6 of `./daily-orbit attachments sync`, after text extraction. The sync pipeline uses the same idempotent query (skips already-summarized rows).

**Prompt configuration:** System and user prompt templates are configurable via the admin UI (AI Settings page) and stored as config keys `summarizationSystemPrompt` and `summarizationUserPrompt`. Blank values fall back to built-in defaults defined in `packages/server/src/inference/prompts.ts`.

**Key options:** `--model` (default: `us.amazon.nova-pro-v1:0`), `--region` (default: `us-east-2`), `--concurrency` (default: 10), `--batch` (default: 100), `--limit`, `--dry-run`

---

### 2e. Full-Text Search Index Rebuild

| | |
|---|---|
| **Command** | `make search-rebuild-index` |
| **CLI** | `./daily-orbit search rebuild-index` |
| **Source** | `filing.description`, `filing.brief_description`, `attachment.full_text`, `attachment.summary`, `pleading.filer_name`, `pleading.exhibit_attachment_html` |
| **Writes to** | DuckDB FTS virtual tables (`fts_main_filing`, `fts_main_attachment`, `fts_main_pleading`) |

**Flow:**

1. Load DuckDB `fts` extension
2. For each indexed table (filing, attachment, pleading):
   - Create BM25 full-text search index with `overwrite=1` (idempotent)
   - Uses English stemmer and stopwords, case-insensitive matching
3. Skip tables whose columns don't exist (graceful degradation in test environments)

**Integration:** FTS rebuild runs automatically as the final step of `./daily-orbit attachments sync`, after summarization completes. Can also be triggered standalone via `make search-rebuild-index`.

**Cost:** Zero — FTS indexes are built entirely from local data already in the database. No external API calls.

---

## Stage 3 — Company Attribution

### 3a. Seed Companies

| | |
|---|---|
| **Command** | `make companies-seed` |
| **CLI** | `./daily-orbit companies seed` |
| **Source** | Built-in `seed-data.ts` (~80 companies, 300+ aliases including prefix patterns) |
| **Writes to** | `company` + `company_alias` tables |

Idempotent: skips companies whose canonical name already exists as an alias. Adds any missing aliases on re-run. Sets parent-subsidiary relationships in a second pass.

### 3b. Batch Attribution

| | |
|---|---|
| **Command** | `make companies-attribute` |
| **CLI** | `./daily-orbit companies attribute` |
| **Source** | `filing` table (rows where `company_id IS NULL`) |
| **Writes to** | `filing.company_id` |

Four-tier deterministic matching for each unattributed filing:

1. **Exact alias match** — `filing.address_attention` = `company_alias.alias_name`
2. **Case-insensitive match** — ILIKE comparison
3. **Prefix alias match** — `filing.address_attention` starts with a registered prefix alias (e.g., `"Comcast of "` matches `"Comcast of Florida/Michigan/..."`)
4. **FRN clustering** — find any already-attributed filing with the same `applicant_frn`, inherit its `company_id`

No match → filing stays unattributed (company_id remains NULL).

**Note:** ICFS filings are also auto-attributed at ingest time (Stage 1b), so the batch mainly catches legacy IBFS filings and any edge cases.

### Attribution Stats

| | |
|---|---|
| **Command** | `make companies-stats` |
| **CLI** | `./daily-orbit companies stats` |

Read-only report: total/attributed/unattributed counts, coverage %, and top 25 unattributed applicant names.

---

## Stage 4 — Ownership Extraction

| | |
|---|---|
| **Command** | `make companies-extract-ownership` |
| **CLI** | `./daily-orbit companies extract-ownership` |
| **Source** | `filing` table (rows where `app_type_code IN ('T/C', 'ASG')`) |
| **Writes to** | `ownership_event` table |

**Flow:**

1. Query T/C (Transfer of Control) and ASG (Assignment) filings that have transfer party data and no existing ownership event
2. For each filing, match `transferor_name` and `transferee_name` to companies via alias lookup
3. If at least one party is identified → create `ownership_event` with type, status (derived from `status_code`), and effective date
4. Skip if neither party can be matched

**Status mapping:** G → granted, D → denied, P/A → pending, X → dismissed

---

## Stage 5 — External Enrichment

| | |
|---|---|
| **Command** | `make companies-enrich` |
| **CLI** | `./daily-orbit companies enrich` |
| **Sources** | GLEIF LEI API + Wikidata SPARQL endpoint |
| **Writes to** | `company` table fields: `gleif_lei`, `wikidata_id`, `stock_ticker`, `stock_exchange`, `industry` |

**Per-company flow:**

1. **GLEIF** — search by legal name → extract LEI (Legal Entity Identifier)
   - Rate limit: 300ms between requests
2. **Wikidata** — SPARQL query for P749 (parent org), P414 (stock exchange), P249 (ticker), P452 (industry)
   - Rate limit: 1 req/sec, custom User-Agent header
3. Update company record with any newly found fields
4. External API failures are non-fatal (logged and skipped)

Only queries companies missing `gleif_lei` or `wikidata_id` — already-enriched companies are skipped.

---

## Daily Run Sequence

The recommended daily pipeline order. Steps 1–2 are fully automated. Steps
3–5 require a human to log in once for ServiceNow authentication; the rest
is automated.

```bash
# 1. Ingest new filings from ICFS (includes auto-attribution)
make icfs-ingest DATE_FROM=$(date -v-1m +%Y-%m)

# 2. Discover and download public attachments, extract text, summarize
make attachments

# 3. Extract ICFS session cookies (opens browser — log in, press Enter)
make attachments-extract-cookies

# 4. Download ServiceNow-hosted attachments using session cookies
make attachments-download-auth

# 5. Extract text from newly downloaded authenticated attachments
make attachments-extract

# 6. Ensure company seed data is current (no-ops if unchanged)
make companies-seed

# 7. Attribute any remaining unattributed filings
make companies-attribute

# 8. Extract ownership events from new T/C and ASG filings
make companies-extract-ownership

# 9. Enrich any companies missing external data
make companies-enrich

# 10. (Optional) Report attribution coverage
make companies-stats
```

---

## Rate Limiting & Concurrency

| Pipeline | Default Delay | Default Concurrency | Notes |
|---|---|---|---|
| ICFS Discovery | 500ms | 4 | Per discovery query batch |
| ICFS Fetch | 500ms | 4 | Per filing detail fetch |
| Attachment Discovery | 500ms | 1 | Per filing page scrape |
| Attachment Download (public) | 500ms | 1 | Per file download |
| Attachment Download (auth) | 500ms | 1 | Start conservative; increase gradually |
| Summarization (Bedrock) | 0ms | 10 | Bedrock handles throttling; concurrency configurable |
| GLEIF API | 300ms | 1 | Built-in rate limiter |
| Wikidata SPARQL | 1000ms | 1 | Per Wikidata policy |

All pipeline stages accept `--delay` and `--concurrency` overrides (except enrichment, which uses built-in rate limiters).

---

## Error Handling & Recovery

| Stage | Behavior | Recovery |
|---|---|---|
| IBFS Ingest | Logs failure to `ingest_log` table | Re-run; `--dry-run` to validate |
| ICFS Ingest | Per-filing error tracking, continues others | Re-run with `--file-numbers` for specific failures |
| Attachment Discovery | Per-filing errors isolated, continues | Re-run; `--stale-after` re-discovers stale entries |
| Attachment Download (public) | Marks individual attachments as `'failed'` | `--retry-failed` retries; `--skip-existing` reconciles disk |
| Attachment Download (auth) | Stops gracefully on session expiry; leaves remaining items `pending` | Re-extract cookies and re-run; resumes from where it stopped |
| Text Extraction | Marks individual attachments as `'failed'`, `'skipped_no_text'`, or `'skipped_auth_error'` | `--retry-failed` retries failed; skipped PDFs stay skipped; auth-error stubs flagged for potential re-download |
| Summarization | Per-attachment errors isolated, continues | Re-run; only processes `summary IS NULL` rows |
| Company Attribution | Pure DB operation, no external calls | Re-run; always processes only `company_id IS NULL` rows |
| Ownership Extraction | Skips unmatched parties, continues | Add missing company aliases, then re-run |
| External Enrichment | API failures are non-fatal, per-company | Re-run; only retries companies missing data |

---

## Key File Locations

| Purpose | Path |
|---|---|
| DuckDB database | `data/daily-orbit.duckdb` |
| Attachment files | `data/attachments/{subsystem}/{file_number}/` |
| IBFS bulk data | `tmp/IBFS/` (extracted `.dat` files) |
| IBFS schema DDL | `tmp/ibfs-schema.txt` |
| CLI entry point | `packages/server/src/bin.ts` |
| CLI commands | `packages/server/src/cli/` |
| IBFS pipeline | `packages/server/src/ingest/` |
| ICFS pipeline | `packages/server/src/icfs/` |
| Attachments pipeline | `packages/server/src/attachments/` |
| ICFS session cookies | `data/icfs-cookies.json` (gitignored) |
| Inference module | `packages/server/src/inference/` |
| Prompt templates | `packages/server/src/inference/prompts.ts` |
| Companies module | `packages/server/src/companies/` |
| Enrichment module | `packages/server/src/enrichment/` |
| Makefile | `Makefile` |
