# Admin Pipeline UI

## Overview

A new admin page at `/admin/pipeline` that exposes all data ingestion pipeline stages as a visual, runnable interface with real-time log streaming. Replaces the need to SSH in and run CLI commands manually.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Concurrency model | Async in-process (no worker threads) | Pipeline functions are already async and yield on I/O. DuckDB is single-writer so threads don't help with write contention. Revisit if benchmarks show event-loop blocking. |
| Log streaming | Server-Sent Events (SSE) | Unidirectional, simple, built into Hono via `c.stream()`. Consistent with planned LLM streaming responses. |
| UI layout | Hybrid vertical list with flow context | Grouped by pipeline phase with visual connectors. Communicates structure without full DAG layout complexity. |
| Log panel | Single shared panel | Only one stage runs at a time (single-writer DB). Prefix lines with stage name for context. |
| Run state persistence | In-memory only | Pipeline is idempotent; domain tables already track per-item status. Add a `pipeline_runs` table later if run history is needed. |

## Page Layout

Two zones:

### Top Zone — Pipeline Steps (scrollable)

Five collapsible groups connected by vertical flow indicators (CSS border/arrow between groups):

1. **Filing Ingest** — `ingest.ibfs`, `ingest.icfs`
2. **Attachments** — `attachments.discover`, `attachments.download`, `attachments.extract`, `attachments.validate`, `attachments.summarize`, `attachments.embed`
3. **Companies** — `companies.seed`, `companies.attribute`, `companies.extract-ownership`, `companies.enrich`
4. **News** — `news.seed`, `news.fetch`, `news.extract`, `news.summarize`, `news.attribute`
5. **Search** — `search.rebuild-index`

Each step is a row: name, one-line description, Run button, status badge (idle / running / success / failed).

Each group header has a "Run All" button that chains its steps sequentially.

Run buttons are disabled while any stage is running (one run at a time).

### Bottom Zone — Log Panel (fixed height, resizable)

Dark background, monospace, auto-scrolling `<pre>`. Log lines prefixed with `[stage-name]` and timestamped. Color-coded: info=white, error=red, progress=dim. "Pin to bottom" toggle when user scrolls up. Clear button in corner.

Note: HTTP request logs from Hono will appear in the stream since they share stdout. Acceptable for v1; can filter by source prefix later.

## Server-Side Architecture

### Stage Registry (`src/pipeline/registry.ts`)

A typed catalog mapping stage IDs to service functions:

```typescript
type PipelineStage = {
  id: string;              // "news.fetch"
  group: string;           // "news"
  name: string;            // "Fetch Articles"
  description: string;     // "Poll RSS feeds for new articles"
  run: (ctx: PipelineContext) => Promise<StageResult>;
};

type PipelineContext = {
  conn: DuckDBConnection;
  config: ConfigService;
  log: (level: 'info' | 'error' | 'progress', message: string) => void;
  onProgress: (processed: number, total: number) => void;
};

type StageResult = {
  itemsProcessed: number;
  itemsFailed: number;
  durationMs: number;
  summary?: string;
};
```

Each stage's `run` function wraps an existing service function:

| Stage ID | Service Function | Module |
|----------|-----------------|--------|
| `ingest.ibfs` | `runIngest()` | `src/ingest/pipeline.ts` |
| `ingest.icfs` | `runIcfsIngest()` | `src/icfs/pipeline.ts` |
| `attachments.discover` | `discoverAttachments()` | `src/attachments/pipeline.ts` |
| `attachments.download` | `downloadAttachments()` | `src/attachments/pipeline.ts` |
| `attachments.extract` | `extractAttachmentText()` | `src/attachments/extract-pipeline.ts` |
| `attachments.validate` | `validateAttachments()` | `src/attachments/validate-pipeline.ts` |
| `attachments.summarize` | `summarizeAttachments()` | `src/inference/summarizers/` |
| `attachments.embed` | `embedAttachments()` | `src/inference/embedding-service.ts` |
| `companies.seed` | `seedCompanies()` | `src/companies/attribution.ts` |
| `companies.attribute` | `runAttribution()` | `src/companies/attribution.ts` |
| `companies.extract-ownership` | `extractOwnership()` | `src/companies/` |
| `companies.enrich` | `enrichCompanies()` | `src/companies/` |
| `news.seed` | `seedNewsSources()` | `src/news/seed-data.ts` |
| `news.fetch` | `fetchAllFeeds()` | `src/news/rss-fetcher.ts` |
| `news.extract` | `extractArticles()` | `src/news/article-extractor.ts` |
| `news.summarize` | `summarizeNews()` | `src/news/summarize-news.ts` |
| `news.attribute` | `attributeNews()` | `src/news/attribute-news.ts` |
| `search.rebuild-index` | `rebuildSearchIndex()` | `src/search/rebuild-index.ts` |

### Pipeline Runner (`src/pipeline/runner.ts`)

Orchestrator that:

- Accepts a list of stage IDs to run sequentially
- Enforces single-run-at-a-time (rejects concurrent requests with 409)
- Calls each stage's `run()` with a `PipelineContext`
- Captures log output and progress, emits via an `EventEmitter`
- Tracks per-stage status and timing in a `lastResults` map (in-memory)
- Maintains a **replay buffer** of the last 500 log lines per run (circular buffer, in-memory). When a new SSE client connects to `/logs/:runId`, the endpoint replays buffered lines first, then switches to live streaming. This lets users navigate away and return without losing context.

### API Routes (`src/pipeline/routes.ts`)

Mounted at `/api/admin/pipeline`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Returns current run state + `lastResults` per stage |
| `POST` | `/run` | Body: `{ stages: ["news.fetch", "news.extract"] }`. Kicks off run, returns `{ runId }`. 409 if already running. |
| `GET` | `/logs/:runId` | SSE endpoint. Replays buffered lines (last 500), then streams live `data: { stage, level, message, timestamp }`. Sends `event: done` with summary on completion. |

## Frontend Components

All in `/packages/web/src/admin/pipeline/`:

| Component | Role |
|-----------|------|
| `PipelinePage.tsx` | Main page. Fetches `/status` on mount. Manages SSE connection lifecycle. |
| `PipelineGroup.tsx` | Collapsible group (Filing Ingest, Attachments, etc.). Vertical flow connector to next group. "Run All" button. |
| `PipelineStep.tsx` | Single row: name, description, status badge, Run button. Updates in real-time from SSE. |
| `LogPanel.tsx` | Fixed bottom panel. Monospace, dark bg, auto-scroll. Color-coded lines. Clear button. |

**State flow:**

1. User clicks Run (step or group "Run All")
2. `POST /pipeline/run` returns `runId`
3. Open `EventSource` on `/pipeline/logs/:runId`
4. SSE replays buffered lines (catching up if navigated away), then streams live
5. SSE events update log panel and stage status badges
6. On `event: done`, close SSE, refresh `/status`

**Navigation away/back:** Pipeline continues server-side. On return, `/status` shows the active `runId`, page reconnects to SSE, replay buffer fills in missed lines.

Built with existing shadcn/ui primitives: Button, Badge, Collapsible, ScrollArea.

## New Files

| Layer | Path |
|-------|------|
| Registry | `packages/server/src/pipeline/registry.ts` |
| Runner | `packages/server/src/pipeline/runner.ts` |
| Routes | `packages/server/src/pipeline/routes.ts` |
| Page | `packages/web/src/admin/pipeline/PipelinePage.tsx` |
| Group | `packages/web/src/admin/pipeline/PipelineGroup.tsx` |
| Step | `packages/web/src/admin/pipeline/PipelineStep.tsx` |
| Log | `packages/web/src/admin/pipeline/LogPanel.tsx` |

## Implementation Sequence

1. **Stage registry** — Define the stage map with all 18 stages, wiring to existing service functions
2. **Pipeline runner** — Orchestrator with EventEmitter-based log capture, single-run enforcement
3. **API routes** — Status, run, and SSE logs endpoints; mount in `app.ts`
4. **LogPanel** — Standalone log viewer component (testable independently)
5. **PipelineStep + PipelineGroup** — Step rows and collapsible groups
6. **PipelinePage** — Assemble everything, wire SSE, add to admin routes
7. **Integration test** — Trigger a lightweight stage (e.g., `news.seed`) via API and verify SSE output

## Future Enhancements

- Filter HTTP request noise from log stream (dedicated EventEmitter instead of stdout capture)
- Worker thread execution if benchmarks show event-loop blocking
- Run history persistence (`pipeline_runs` table)
- "Run Full Pipeline" button that chains all groups in order
- Stage dependency graph enforcement (prevent running `news.summarize` before `news.extract`)
