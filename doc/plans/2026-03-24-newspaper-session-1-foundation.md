# Newspaper Session 1: Foundation — Daily Digest Pipeline

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the end-to-end newspaper content pipeline foundation: schema, repository, generator interface, the "3 Miles Up" daily digest generator, pipeline registration, API routes, CLI, and the FCC Public Notices RSS source. After this session, `./daily-orbit newspaper generate` produces a stored daily digest article served via API.

**Architecture:** New `packages/server/src/newspaper/` submodule following existing patterns (news/, companies/). Repository pattern with DuckDB. Generators are pure functions receiving dependencies as arguments. Pipeline stages registered in the existing registry. Config keys follow the `{feature}{Setting}` convention.

**Prereqs:** Existing pipeline framework, inference service, news seed-data infrastructure.

---

## Task 1: Create Newspaper Types

**Files:**
- New: `packages/server/src/newspaper/types.ts`

Define TypeScript types mirroring the data model:

```typescript
export type NewspaperEdition = {
  id: number;
  editionDate: string;         // ISO date string
  editionType: 'daily' | 'weekly';
  status: 'pending' | 'generating' | 'complete' | 'failed';
  pipelineRunId: number | null;
  heroImagePath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewspaperArticle = {
  id: number;
  editionId: number;
  contentType: NewspaperContentType;
  slug: string;
  headline: string | null;
  body: string;                // markdown
  sourceData: string | null;   // JSON blob
  generatedBy: string | null;  // model ID or 'static'
  imagePath: string | null;
  imagePrompt: string | null;
  displayOrder: number;
  status: 'pending' | 'generated' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type NewspaperContentType =
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial'
  | 'editorial_cartoon'
  | 'company_spotlight'
  | 'orbital_forecast'
  | 'classifieds';

export type NewspaperImage = {
  id: number;
  imageType: 'portrait' | 'section_header' | 'logo';
  imagePath: string;
  prompt: string | null;
  tags: string[];
  generatedBy: string | null;
  createdAt: string;
};

/** Common interface for all content generators */
export type GeneratorResult = {
  headline: string;
  body: string;
  imagePath?: string;
  imagePrompt?: string;
  sourceData: Record<string, unknown>;
};

export type GenerateOptions = {
  conn: DuckDBConnection;
  editionId: number;
  editionDate: string;
  inferenceService: InferenceService;
  config: ConfigService;
  log: (level: 'info' | 'error', message: string) => void;
};
```

Import `DuckDBConnection` from the existing DB types, `InferenceService` from `../inference/inference-service.ts`, `ConfigService` from `../lib/config.ts`.

---

## Task 2: Create Newspaper Schema

**Files:**
- New: `packages/server/src/newspaper/schema.ts`

Follow the pattern of `packages/server/src/news/schema.ts` — idempotent `ensureNewspaperTables(conn)`.

Three tables:

**newspaper_edition:**
```sql
CREATE SEQUENCE IF NOT EXISTS newspaper_edition_id_seq START 1;
CREATE TABLE IF NOT EXISTS newspaper_edition (
  id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_edition_id_seq'),
  edition_date    DATE NOT NULL UNIQUE,
  edition_type    VARCHAR NOT NULL DEFAULT 'daily',
  status          VARCHAR NOT NULL DEFAULT 'pending',
  pipeline_run_id INTEGER,
  hero_image_path VARCHAR,
  created_at      TIMESTAMP DEFAULT current_timestamp,
  updated_at      TIMESTAMP DEFAULT current_timestamp
);
```

**newspaper_article:**
```sql
CREATE SEQUENCE IF NOT EXISTS newspaper_article_id_seq START 1;
CREATE TABLE IF NOT EXISTS newspaper_article (
  id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_article_id_seq'),
  edition_id      INTEGER NOT NULL,
  content_type    VARCHAR NOT NULL,
  slug            VARCHAR NOT NULL,
  headline        VARCHAR,
  body            VARCHAR NOT NULL,
  source_data     VARCHAR,
  generated_by    VARCHAR,
  image_path      VARCHAR,
  image_prompt    VARCHAR,
  display_order   INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT current_timestamp,
  updated_at      TIMESTAMP DEFAULT current_timestamp,
  UNIQUE (edition_id, slug)
);
```

**newspaper_image:**
```sql
CREATE SEQUENCE IF NOT EXISTS newspaper_image_id_seq START 1;
CREATE TABLE IF NOT EXISTS newspaper_image (
  id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_image_id_seq'),
  image_type      VARCHAR NOT NULL,
  image_path      VARCHAR NOT NULL UNIQUE,
  prompt          VARCHAR,
  tags            VARCHAR[],
  generated_by    VARCHAR,
  created_at      TIMESTAMP DEFAULT current_timestamp
);
```

**Verify:** Unit test that `ensureNewspaperTables` is idempotent (call twice, no error).

---

## Task 3: Create Newspaper Repository

**Files:**
- New: `packages/server/src/newspaper/repository.ts`
- New: `packages/server/src/newspaper/repository.test.ts`

Follow `packages/server/src/news/repository.ts` pattern. Use compiled SQL with `?`-style parameters.

**Functions:**

```typescript
// Edition CRUD
ensureEdition(conn, date: string): Promise<NewspaperEdition>
  // Upsert: create if not exists, return existing if already present
getEditionByDate(conn, date: string): Promise<NewspaperEdition | null>
getLatestEdition(conn): Promise<NewspaperEdition | null>
listEditions(conn, limit: number, offset: number): Promise<NewspaperEdition[]>
updateEditionStatus(conn, id: number, status: string): Promise<void>

// Article CRUD
upsertArticle(conn, editionId: number, article: Partial<NewspaperArticle>): Promise<NewspaperArticle>
  // Upsert by (edition_id, slug) — idempotent
getArticlesByEdition(conn, editionId: number): Promise<NewspaperArticle[]>
getArticle(conn, editionId: number, slug: string): Promise<NewspaperArticle | null>
resetArticle(conn, editionId: number, slug: string): Promise<void>
  // Set status back to 'pending' for regeneration
```

**Tests:** Use in-memory DuckDB (following `D-3` rule). Test:
- `ensureEdition` creates and is idempotent
- `upsertArticle` creates and updates
- `getArticlesByEdition` returns ordered by display_order
- `resetArticle` sets status to pending

---

## Task 4: Create Newspaper Prompts

**Files:**
- New: `packages/server/src/newspaper/prompts.ts`

Follow `packages/server/src/inference/prompts.ts` pattern. Define default prompts and template variables.

```typescript
import type { TemplateVariable } from '../inference/prompts.ts';

export const NEWSPAPER_COPY_VARIABLES: ReadonlyArray<TemplateVariable> = [
  { name: 'editionDate', description: 'Display-formatted date', source: 'edition', example: 'Monday, March 24, 2026' },
  { name: 'filingSummaries', description: 'Markdown list of recent notable filings with summaries', source: 'db query', example: '- SAT-LOA-20260324-00042: Hughes Network Systems filed...' },
  { name: 'newsSummaries', description: 'Markdown list of recent news headlines + summaries', source: 'db query', example: '- SpaceNews: Viasat announces...' },
];

export const DEFAULT_DIGEST_SYSTEM_PROMPT: string = `You are the editor of "The Daily Orbit," a newspaper covering the US satellite communications regulatory landscape. Your writing style emulates early 20th century broadsheet journalism: authoritative, concise, and slightly formal. You write in the third person. You never use bullet points — everything is flowing prose organized into short paragraphs.

You produce a daily digest column called "3 Miles Up" that summarizes the day's most notable FCC filings and industry news for an audience of telecommunications attorneys and business strategists.`;

export const DEFAULT_DIGEST_USER_PROMPT: string = `Write today's "3 Miles Up" column for {{editionDate}}.

Today's notable filings:
{{{filingSummaries}}}

Recent industry news:
{{{newsSummaries}}}

Write 2-3 paragraphs. Reference specific file numbers and company names. Include links to Daily Orbit filing pages as [Company Name](/filings/FILE-NUMBER). At the bottom, include source attributions as "Source: [Publication Name](original-url)".`;
```

---

## Task 5: Create Daily Digest Generator

**Files:**
- New: `packages/server/src/newspaper/generators/daily-digest.ts`
- New: `packages/server/src/newspaper/generators/daily-digest.test.ts`

The generator:
1. Queries recent filings (today + yesterday) with summaries from the DB
2. Queries recent news items (last 24h) with summaries from the DB
3. Renders the prompt template with `renderPrompt()` from `../inference/prompts.ts`
4. Calls `inferenceService.complete()` with the configured model and prompts
5. Returns `GeneratorResult` with headline extracted from first line, body as markdown, sourceData with filing numbers and news item IDs

```typescript
export async function generateDailyDigest(opts: GenerateOptions): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query input data
  log('info', 'Querying recent filings and news...');
  const filings = await queryRecentFilings(conn, editionDate);
  const news = await queryRecentNews(conn, editionDate);

  if (filings.length === 0 && news.length === 0) {
    return {
      headline: 'A Quiet Day on the Docket',
      body: 'No new filings or notable industry developments were recorded.',
      sourceData: { filings: [], news: [] },
    };
  }

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string = (config.get('newspaperCopySystemPrompt') as string) || DEFAULT_DIGEST_SYSTEM_PROMPT;
  const userTemplate: string = (config.get('newspaperCopyUserPrompt') as string) || DEFAULT_DIGEST_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    filingSummaries: formatFilingSummaries(filings),
    newsSummaries: formatNewsSummaries(news),
  });

  // 3. Call inference
  log('info', `Generating daily digest with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? '3 Miles Up';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      filings: filings.map(f => f.fileNumber),
      news: news.map(n => ({ id: n.id, title: n.title, sourceUrl: n.sourceUrl })),
      modelId,
    },
  };
}
```

Helper functions `queryRecentFilings` and `queryRecentNews` query the existing `filing` and `news_item` tables.

**Tests:** Mock `inferenceService.complete()` with a canned response. Test that:
- Empty input produces a fallback article
- Filing/news data is correctly formatted into the prompt
- Response is parsed into headline + body
- Source data includes filing numbers and news IDs

---

## Task 6: Add Config Keys

**Files:**
- Modify: `packages/server/src/lib/config-schema.ts`

Add after the existing `queryGenerateUserPrompt` entry:

```typescript
newspaperCopyModel: {
  key: 'newspaperCopyModel',
  defaultValue: 'us.amazon.nova-pro-v1:0',
  encrypted: false,
  description: 'Bedrock model ID for newspaper article generation',
},
newspaperCopySystemPrompt: {
  key: 'newspaperCopySystemPrompt',
  defaultValue: '',
  encrypted: false,
  description: 'System prompt for newspaper article generation (blank = built-in default)',
},
newspaperCopyUserPrompt: {
  key: 'newspaperCopyUserPrompt',
  defaultValue: '',
  encrypted: false,
  description: 'User prompt template for newspaper article generation (blank = built-in default)',
},
newspaperImageModel: {
  key: 'newspaperImageModel',
  defaultValue: 'amazon.nova-canvas-v1:0',
  encrypted: false,
  description: 'Bedrock model ID for newspaper image generation (Nova Canvas)',
},
newspaperEditorialSystemPrompt: {
  key: 'newspaperEditorialSystemPrompt',
  defaultValue: '',
  encrypted: false,
  description: 'System prompt for editorial generation (blank = shared newspaper prompt)',
},
newspaperEditorialUserPrompt: {
  key: 'newspaperEditorialUserPrompt',
  defaultValue: '',
  encrypted: false,
  description: 'User prompt for editorial generation (blank = built-in default)',
},
```

---

## Task 7: Register Pipeline Stages

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`

Add two stages to the `STAGES` array (following the existing news stage pattern with lazy imports):

```typescript
// ── Newspaper ──────────────────────────────────────────
{
  id: 'newspaper.ensure-edition',
  group: 'newspaper',
  name: 'Create Edition',
  description: 'Create today\'s newspaper edition if it doesn\'t exist (gates on 9am ET)',
  defaultConcurrency: 1,
  parallelizable: false,
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
    const { ensureEdition } = await import('../newspaper/repository.ts');
    const start: number = Date.now();
    await ensureNewspaperTables(ctx.conn);

    // Gate: skip if before 9am Eastern
    const eastern: string = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const hour: number = new Date(eastern).getHours();
    if (hour < 9) {
      ctx.log('info', 'Before 9am ET — skipping newspaper generation');
      return { itemsProcessed: 0, itemsSkipped: 1, itemsFailed: 0, durationMs: Date.now() - start };
    }

    const today: string = new Date().toISOString().split('T')[0];
    const edition = await ensureEdition(ctx.conn, today);
    ctx.log('info', `Edition ${edition.editionDate}: status=${edition.status}`);
    return { itemsProcessed: 1, itemsFailed: 0, durationMs: Date.now() - start };
  },
},
{
  id: 'newspaper.daily-digest',
  group: 'newspaper',
  name: 'Daily Digest',
  description: 'Generate "3 Miles Up" lead article from today\'s filings and news',
  defaultConcurrency: 1,
  parallelizable: false,
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
    const { getEditionByDate, upsertArticle, getArticle } = await import('../newspaper/repository.ts');
    const { generateDailyDigest } = await import('../newspaper/generators/daily-digest.ts');
    const { getConfigService } = await import('../lib/config.ts');
    const { InferenceService } = await import('../inference/inference-service.ts');
    const { InstrumentedBedrockClient } = await import('../inference/instrumented-client.ts');
    const { BedrockClient } = await import('../inference/bedrock-client.ts');
    const start: number = Date.now();
    await ensureNewspaperTables(ctx.conn);

    const today: string = new Date().toISOString().split('T')[0];
    const edition = await getEditionByDate(ctx.conn, today);
    if (!edition) {
      ctx.log('info', 'No edition for today — skipping');
      return { itemsProcessed: 0, itemsSkipped: 1, itemsFailed: 0, durationMs: Date.now() - start };
    }

    // Skip if already generated
    const existing = await getArticle(ctx.conn, edition.id, 'three-miles-up');
    if (existing?.status === 'generated') {
      ctx.log('info', 'Daily digest already generated — skipping');
      return { itemsProcessed: 0, itemsSkipped: 1, itemsFailed: 0, durationMs: Date.now() - start };
    }

    const config = getConfigService();
    const region: string = config.get('bedrockRegion') as string;
    const client = new InstrumentedBedrockClient(new BedrockClient(region), ctx.conn, 'newspaper');
    const inferenceService = new InferenceService(client);

    const result = await generateDailyDigest({
      conn: ctx.conn,
      editionId: edition.id,
      editionDate: today,
      inferenceService,
      config,
      log: ctx.log,
    });

    await upsertArticle(ctx.conn, edition.id, {
      contentType: 'daily_digest',
      slug: 'three-miles-up',
      headline: result.headline,
      body: result.body,
      sourceData: JSON.stringify(result.sourceData),
      generatedBy: config.get('newspaperCopyModel') as string,
      displayOrder: 1,
      status: 'generated',
    });

    return { itemsProcessed: 1, itemsFailed: 0, durationMs: Date.now() - start };
  },
},
```

Add the group to `PIPELINE_GROUPS` (at the end, after 'alerts'):

```typescript
{
  id: 'newspaper',
  name: 'Newspaper',
  stageIds: [
    'newspaper.ensure-edition',
    'newspaper.daily-digest',
  ],
},
```

More stages will be added in later sessions.

---

## Task 8: Add API Routes

**Files:**
- New: `packages/server/src/newspaper/routes.ts`
- Modify: `packages/server/src/app.ts` (register routes)

Routes following the pattern of `packages/server/src/news/routes.ts`:

```typescript
// GET /api/newspaper/edition/latest  — most recent edition with all articles
// GET /api/newspaper/edition/:date   — edition by date with all articles
// GET /api/newspaper/editions        — paginated edition list (limit, offset)
```

Register in `app.ts` alongside existing route registrations.

---

## Task 9: Add CLI Commands

**Files:**
- New: `packages/server/src/cli/newspaper/index.ts`

Following the pattern of `packages/server/src/cli/news/index.ts` using `citty`:

```
newspaper generate [--date YYYY-MM-DD] [--type content_type]
newspaper regenerate --date YYYY-MM-DD [--article slug]
newspaper list
newspaper show --date YYYY-MM-DD
```

The `generate` command creates the DB connection, bootstraps config, calls the generator directly (not through the pipeline runner).

---

## Task 10: Add FCC Public Notices RSS Source

**Files:**
- Modify: `packages/server/src/news/seed-data.ts`

Add to `NEWS_SOURCE_SEED_DATA` array in the Tier 1 section:

```typescript
{
  name: 'FCC Public Notices (IBFS)',
  feedUrl: 'https://fcc.report/IBFS/Filing-List/Public-Notices.rss',
  category: 'regulatory',
  enabled: true,
},
```

This feeds into the existing news pipeline — no separate newspaper handling needed. Run `./daily-orbit news seed` to pick it up.

---

## Verification

1. `make test` — all new unit tests pass (repository, generator, schema idempotency)
2. `./daily-orbit news seed` — FCC Public Notices source appears in seed output
3. `./daily-orbit newspaper generate` — generates a daily digest article
4. `./daily-orbit newspaper show --date $(date +%Y-%m-%d)` — displays the article in terminal
5. `curl localhost:9000/api/newspaper/edition/latest` — returns JSON with edition + articles
6. Pipeline admin UI shows "Newspaper" group with 2 stages (automatic — no frontend changes needed)
