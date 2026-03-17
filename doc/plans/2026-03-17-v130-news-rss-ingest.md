# v1.3.0 — News Items Entity & RSS Ingest

## Context

Daily Orbit enriches its FCC filing dataset with industry context by ingesting news
from satellite communications trade publications, operator press releases, regulatory
feeds, and M&A sources. This milestone adds:

1. A **NewsSource** entity modelling RSS/Atom feed endpoints
2. A **NewsItem** entity for individual articles
3. A pipeline stage that fetches feeds, extracts article text as markdown, summarizes
   via Bedrock, and attributes articles to tracked companies
4. A **modular summarization** refactor so FCC filings and news articles use
   independent, admin-configurable prompt sets

Stock price ingestion is deferred (RSS cannot deliver valuations; a financial API
integration will follow). Frontend views are out of scope — this plan covers backend
pipeline, CLI, and API only.

---

## RSS Feed Sources

### Tier 1 — Core Satellite Industry (seed enabled by default)

| Source | Feed URL | Category |
|--------|----------|----------|
| SpaceNews | `https://spacenews.com/feed/` | industry |
| Via Satellite | `https://www.satellitetoday.com/feed/` | industry |
| SatNews | `https://news.satnews.com/feed/` | industry |
| FCC Federal Register | `https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=federal-communications-commission` | regulatory |

### Tier 2 — Operator Press Releases

| Source | Feed URL | Category |
|--------|----------|----------|
| Viasat Investor | `https://investors.viasat.com/rss-news-feeds` | operator |
| EchoStar / Hughes | `https://ir.echostar.com/rss-news-feeds` | operator |
| Eutelsat / OneWeb | `https://www.mynewsdesk.com/eutelsat/rss` | operator |

### Tier 3 — M&A / Telecom Analysis

| Source | Feed URL | Category |
|--------|----------|----------|
| Telecom Ramblings | `http://feeds2.feedburner.com/TelecomRamblings` | financial |
| Ars Technica Space | `https://arstechnica.com/space/feed/` | community |
| Spaceflight Now | `https://spaceflightnow.com/feed/` | community |

### Notable gaps

- **SpaceX / Starlink** and **Amazon Leo (Kuiper)** do not publish RSS. Best proxy:
  `https://spacenews.com/tag/spacex/feed/` and `https://spacenews.com/tag/kuiper/feed/`
- **Stock prices** are not available via RSS in 2026. Yahoo Finance RSS
  (`https://finance.yahoo.com/rss/headline?s={TICKER}`) provides *news about* tickers
  but not valuations. Defer to a financial API (Alpha Vantage, Polygon.io) in a later milestone.

---

## Data Model

### `news_source` table

```sql
CREATE SEQUENCE IF NOT EXISTS news_source_id_seq START 1;
CREATE TABLE IF NOT EXISTS news_source (
  id                     INTEGER PRIMARY KEY DEFAULT nextval('news_source_id_seq'),
  name                   VARCHAR NOT NULL,
  feed_url               VARCHAR NOT NULL UNIQUE,
  category               VARCHAR NOT NULL DEFAULT 'industry',
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,
  fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_fetched_at        TIMESTAMP,
  last_fetch_status      VARCHAR,       -- 'success' | 'failed'
  last_fetch_error       VARCHAR,
  created_at             TIMESTAMP DEFAULT current_timestamp,
  updated_at             TIMESTAMP DEFAULT current_timestamp
);
```

### `news_item` table

```sql
CREATE SEQUENCE IF NOT EXISTS news_item_id_seq START 1;
CREATE TABLE IF NOT EXISTS news_item (
  id              INTEGER PRIMARY KEY DEFAULT nextval('news_item_id_seq'),
  news_source_id  INTEGER NOT NULL,
  source_url      VARCHAR NOT NULL,
  title           VARCHAR NOT NULL,
  author          VARCHAR,
  published_at    TIMESTAMP,
  fetched_at      TIMESTAMP DEFAULT current_timestamp,
  full_text       VARCHAR,            -- markdown, populated after article fetch
  text_length     INTEGER,
  text_checksum   VARCHAR,            -- MD5 of full_text, for summary dedup
  summary         VARCHAR,
  summarized_by   VARCHAR,            -- model ID or 'copied'
  summarized_at   TIMESTAMP,
  extract_status  VARCHAR NOT NULL DEFAULT 'pending',
  company_id      INTEGER,            -- FK to company, nullable
  tags            VARCHAR[],          -- from RSS categories
  created_at      TIMESTAMP DEFAULT current_timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_item_source_url ON news_item(source_url);
CREATE INDEX IF NOT EXISTS idx_news_item_text_checksum ON news_item(text_checksum);
CREATE INDEX IF NOT EXISTS idx_news_item_extract_status ON news_item(extract_status);
CREATE INDEX IF NOT EXISTS idx_news_item_company_id ON news_item(company_id);
```

---

## Summarization Modularity Refactor

### Current state

All prompts live in `packages/server/src/inference/prompts.ts` as flat constants.
Config keys `summarizationSystemPrompt` / `summarizationUserPrompt` override them.
The summarize CLI command (`packages/server/src/cli/inference/summarize.ts`) imports
these constants directly.

### Target state

```
packages/server/src/inference/
  prompts.ts                        # keeps existing exports (backwards compat)
  summarizers/
    types.ts                        # SummarizerConfig interface
    fcc-attachment.ts               # existing FCC prompts wrapped in config
    news-article.ts                 # news-specific prompts
```

#### `SummarizerConfig` interface

```typescript
type SummarizerConfig = {
  readonly typeId: string;                       // 'fcc-attachment' | 'news-article'
  readonly displayName: string;
  readonly configKeyPrefix: string;              // maps to DB config keys
  readonly variables: readonly TemplateVariable[];
  readonly defaultSystemPrompt: string;
  readonly defaultUserPrompt: string;
  readonly defaultChunkUserPrompt: string;
  readonly defaultReduceUserPrompt: string;
};
```

#### Backwards compatibility

The FCC summarizer uses `configKeyPrefix: 'summarization'`, which maps to the
existing config keys `summarizationSystemPrompt` and `summarizationUserPrompt`.
No migration needed — admin-customized prompts continue to work.

The news summarizer uses `configKeyPrefix: 'newsSummarization'`, adding new config keys:
- `newsSummarizationModel`
- `newsSummarizationSystemPrompt`
- `newsSummarizationUserPrompt`

#### News article prompts

The system prompt focuses on satellite industry impact analysis for attorneys and
strategists. Template variables: `sourceUrl`, `sourceName`, `title`, `author`,
`publishedAt`, `fullText`, `tags`.

---

## Pipeline Design — Stage 6: News

```
6a. Seed News Sources     ./daily-orbit news seed
6b. RSS Feed Fetch        ./daily-orbit news fetch
6c. Article Extraction    ./daily-orbit news extract
6d. News Summarization    ./daily-orbit news summarize
6e. Company Attribution   ./daily-orbit news attribute
6f. FTS Index Rebuild     ./daily-orbit search rebuild-index  (existing, add news_item)
```

All stages are idempotent, following the existing pipeline pattern.

### 6a. Seed News Sources

Load `NEWS_SOURCE_SEED_DATA` into `news_source` table. Skip if `feed_url` already
exists (same pattern as `companies seed`).

### 6b. RSS Feed Fetch

1. Query `getSourcesDueForFetch()` — enabled sources where
   `last_fetched_at IS NULL OR last_fetched_at + interval < now`
2. For each source, parse RSS/Atom feed via `rss-parser`
3. Map each RSS item → `upsertNewsItem()` with `ON CONFLICT(source_url) DO NOTHING`
4. Update `last_fetched_at`, `last_fetch_status` on the source
5. Sequential per-source (polite); parallelism is across items within a source

### 6c. Article Text Extraction

1. Query `getNewsItemsNeedingExtraction()` — `extract_status = 'pending'`
2. For each item, fetch the article URL and extract clean content via
   `@extractus/article-extractor` (Readability-style extraction → markdown)
3. Compute `text_checksum` via `computeTextChecksum()` (reuse from attachments)
4. Store `full_text`, `text_length`, `text_checksum`, update `extract_status`
5. Concurrency: 3–5 (be polite to publishers)

### 6d. News Summarization

Same architecture as attachment summarization (`cli/inference/summarize.ts`),
parameterized by `NEWS_ARTICLE_SUMMARIZER` config:

1. Query news items with `full_text IS NOT NULL AND summary IS NULL`
2. Checksum dedup: copy existing summary if `text_checksum` matches
3. Render news-specific Mustache template
4. Call `InferenceService.complete()`
5. Store summary + `summarized_by` + `summarized_at`

### 6e. Company Attribution

Heuristic matching (MVP — future versions can use NER/LLM):

1. Query news items where `company_id IS NULL AND full_text IS NOT NULL`
2. Load all company aliases
3. Scan `title` + first 500 chars of `full_text` for case-insensitive alias matches
4. Single match → set `company_id`. Multiple matches → pick highest-frequency alias.
   Zero matches → leave null.

### 6f. FTS Index

Add to `FTS_INDEXES` array in `packages/server/src/search/fts-index.ts`:

```typescript
{ table: 'news_item', keyColumn: 'id', textColumns: ['title', 'full_text', 'summary'] },
```

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `rss-parser` | Parse RSS 2.0, Atom, and RDF feeds |
| `@extractus/article-extractor` | Readability-style article extraction → clean HTML/text |

---

## Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `packages/server/src/news/types.ts` | `NewsSource`, `NewsItem`, status union types |
| 2 | `packages/server/src/news/schema.ts` | `ensureNewsTables(conn)` — idempotent DDL |
| 3 | `packages/server/src/news/repository.ts` | CRUD + pipeline query functions |
| 4 | `packages/server/src/news/seed-data.ts` | `NEWS_SOURCE_SEED_DATA` array |
| 5 | `packages/server/src/news/rss-fetcher.ts` | RSS parsing, feed fetch, item upsert |
| 6 | `packages/server/src/news/article-extractor.ts` | URL → markdown extraction |
| 7 | `packages/server/src/news/summarize-news.ts` | News summarization pipeline |
| 8 | `packages/server/src/news/attribute-news.ts` | Company attribution for news |
| 9 | `packages/server/src/news/routes.ts` | API routes (public + admin) |
| 10 | `packages/server/src/cli/news/index.ts` | CLI subcommands |
| 11 | `packages/server/src/inference/summarizers/types.ts` | `SummarizerConfig` interface |
| 12 | `packages/server/src/inference/summarizers/fcc-attachment.ts` | FCC prompts as config |
| 13 | `packages/server/src/inference/summarizers/news-article.ts` | News prompts |
| 14 | `packages/server/src/news/repository.test.ts` | Repository unit tests |
| 15 | `packages/server/src/news/rss-fetcher.test.ts` | RSS fetcher unit tests |
| 16 | `packages/server/src/news/article-extractor.test.ts` | Article extractor tests |

## Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `packages/server/src/lib/db-init.ts` | Add `ensureNewsTables(conn)` call |
| 2 | `packages/server/src/cli/index.ts` | Add `news: newsCommand` subcommand |
| 3 | `packages/server/src/inference/prompts.ts` | Re-export from `summarizers/` (keep all existing exports) |
| 4 | `packages/server/src/lib/config-schema.ts` | Add `newsSummarization*` config keys |
| 5 | `packages/server/src/search/fts-index.ts` | Add `news_item` to `FTS_INDEXES` |
| 6 | `Makefile` | Add `news-*` targets |
| 7 | `doc/ingestion-pipeline.md` | Document Stage 6 |
| 8 | `doc/roadmap.md` | Mark v1.3.0 in progress |
| 9 | `doc/datamodel.md` | Add NewsSource + NewsItem sections |

---

## Implementation Phases

### Phase 1 — Foundation

> types.ts, schema.ts, repository.ts, repository.test.ts, seed-data.ts, db-init.ts

Create the data model, repository layer, and tests. Wire schema into DB init.
Tests use in-memory DuckDB following `companies/repository.test.ts` pattern.

**Key patterns to follow:**
- `packages/server/src/companies/schema.ts` — sequence + CREATE TABLE IF NOT EXISTS
- `packages/server/src/companies/repository.ts` — pure functions, `DuckDBConnection` first param, row mappers
- `packages/server/src/companies/types.ts` — camelCase types with null unions

### Phase 2 — RSS Fetch Pipeline

> rss-fetcher.ts, rss-fetcher.test.ts, cli/news/index.ts (seed + fetch commands)

Add `rss-parser` dep. Implement feed fetching with dedup-by-URL upsert.
Wire CLI commands. Add Makefile targets.

### Phase 3 — Article Text Extraction

> article-extractor.ts, article-extractor.test.ts, cli news extract command

Add `@extractus/article-extractor` dep. Fetch article HTML, extract clean
content. Reuse `computeTextChecksum()` from attachment repository.
Use `processWithConcurrency()` from `packages/server/src/lib/concurrency.ts`.

### Phase 4 — Summarization Modularity Refactor

> summarizers/types.ts, summarizers/fcc-attachment.ts, summarizers/news-article.ts,
> config-schema.ts updates, prompts.ts re-exports

Extract `SummarizerConfig` interface. Move FCC prompts into config object.
Create news prompts. Add config keys. **All existing exports in prompts.ts
remain unchanged** — the existing summarize command continues working without
modification.

### Phase 5 — News Summarization + Attribution

> summarize-news.ts, attribute-news.ts, cli news summarize/attribute commands

Follow the batch-fetch → checksum-dedup → LLM → save pattern from
`cli/inference/summarize.ts`. Company attribution scans article text against
the company alias table.

### Phase 6 — API Routes + FTS

> routes.ts, fts-index.ts update, app.ts route mounting

REST API for listing/filtering news items and managing sources (admin).
One-line addition to FTS_INDEXES array.

### Phase 7 — Documentation

> ingestion-pipeline.md, roadmap.md, datamodel.md

Document Stage 6 in the pipeline diagram and daily run sequence.

### Dependency graph

```
Phase 1 (Foundation)
  ├── Phase 2 (RSS Fetch)
  │     └── Phase 3 (Article Extraction)
  │           └── Phase 5 (Summarization + Attribution)
  ├── Phase 4 (Summarizer Refactor) ← independent of 2/3
  │     └── Phase 5 (uses SummarizerConfig)
  ├── Phase 6 (API + FTS) ← depends on repository
  └── Phase 7 (Docs) ← last
```

Phases 2+3 and Phase 4 can be developed in parallel.

---

## API Endpoints

```
GET    /api/news                    List news items (paginated, filterable by source/company/date)
GET    /api/news/:id                Get single news item
GET    /api/news/sources            List news sources

POST   /api/admin/news/sources      Create news source
PUT    /api/admin/news/sources/:id  Update news source (enable/disable, change interval)
POST   /api/admin/news/sources/:id/fetch  Trigger manual fetch for a source
DELETE /api/admin/news/sources/:id  Delete news source
```

---

## Makefile Targets

```makefile
news-seed:        ## Seed default RSS feed sources
news-fetch:       ## Fetch RSS feeds and store new items
news-extract:     ## Download and extract article text
news-summarize:   ## Summarize extracted news articles
news-attribute:   ## Match news items to companies
news:             ## Run full news pipeline (seed + fetch + extract + summarize + attribute)
```

---

## Daily Run Sequence Addition

After existing Step 10 (`make companies-stats`), add:

```bash
# 11. Seed news sources (no-ops if unchanged)
make news-seed

# 12. Fetch RSS feeds for new articles
make news-fetch

# 13. Extract article text from new news items
make news-extract

# 14. Summarize new articles
make news-summarize

# 15. Attribute news items to companies
make news-attribute
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `rss-parser` edge cases with non-standard feeds | Try/catch per-source; log errors and continue; `last_fetch_error` column for diagnostics |
| `@extractus/article-extractor` fails on paywalled/JS-rendered sites | Mark `extract_status = 'failed'`; enable retry; article extraction is best-effort |
| DuckDB `ON CONFLICT` syntax | DuckDB >=0.8 supports this; verify with current version; fallback to SELECT-then-INSERT if needed |
| Summarization refactor breaks existing FCC pipeline | All existing exports in `prompts.ts` preserved; FCC summarize command imports unchanged; run existing tests to verify |
| RSS feed URLs change or go offline | `enabled` flag + `last_fetch_status` / `last_fetch_error` track health; admin can disable broken sources |

---

## Verification

1. **Unit tests**: `pnpm test` — repository CRUD, RSS parsing, article extraction
2. **Integration test**: Seed sources → fetch one feed → verify news_item rows created
3. **Manual pipeline run**:
   ```bash
   make news-seed
   make news-fetch ARGS="--limit 1"
   make news-extract ARGS="--limit 5"
   make news-summarize ARGS="--limit 3 --dry-run"
   make db-query SQL="SELECT count(*) FROM news_item"
   make db-query SQL="SELECT count(*) FROM news_source"
   ```
4. **Backwards compat**: Run `make summarize ARGS="--dry-run"` — must still work unchanged
5. **FTS**: Run `make search-rebuild-index` — should now index news_item without errors
