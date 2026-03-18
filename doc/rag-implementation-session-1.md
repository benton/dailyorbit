# RAG Implementation — Session 1: Backend Query Pipeline

**Depends on:** [query-rewriting-rag-strategy.md](query-rewriting-rag-strategy.md)
**Produces:** A working `POST /api/query` endpoint that accepts a question and returns a streamed, cited answer via SSE.

---

## Scope

This session builds the entire server-side RAG pipeline:

1. Query rewriting service
2. Hybrid retrieval integration (reusing existing search infrastructure)
3. Answer generation with streaming
4. SSE streaming endpoint
5. Transparency events (show the user what's happening)
6. Tests

The frontend is **not** in scope — Session 2 handles that.

---

## Architecture Decisions

### SSE over WebSocket

The RAG query is a request/response pattern with streaming output — not a bidirectional channel. **Server-Sent Events (SSE)** is the right fit:

- Hono 4.7 has built-in `streamSSE()` support via `hono/streaming`
- No new infrastructure (no WS server, no connection lifecycle management)
- Works through HTTP proxies and CDNs without special config
- The frontend consumes it with `EventSource` or `fetch()` + `ReadableStream`
- If we later need bidirectional features (e.g., cancel-in-flight), SSE supports client-initiated close and we can add a cancel endpoint

### Bedrock ConverseStream for token streaming

The existing `BedrockClient.converse()` uses the non-streaming `ConverseCommand`. For RAG answer generation, we'll add a `converseStream()` method that uses `ConverseStreamCommand` from `@aws-sdk/client-bedrock-runtime`. This yields token-by-token output that we pipe directly into the SSE stream.

### Structured SSE event types

The SSE stream sends typed JSON events so the frontend can render progressive UI:

```typescript
type QuerySSEEvent =
  | { type: 'status'; stage: 'rewriting' | 'retrieving' | 'generating'; message: string }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }           // incremental answer token(s)
  | { type: 'usage'; usage: QueryUsage }       // token counts, latency
  | { type: 'done' }
  | { type: 'error'; message: string }
```

This powers the transparency requirement: the frontend shows "Analyzing your question...", then "Searching 3 document types...", then streams the answer, then shows cost/usage metadata.

---

## Implementation Steps

### Step 0 — Config keys for RAG models and limits

**File:** `packages/server/src/lib/config-schema.ts` (edit)

Add three new config entries following the existing pattern:

```typescript
queryRewriteModel: {
  key: 'queryRewriteModel',
  defaultValue: 'us.amazon.nova-micro-v1:0',  // cheap & fast for rewriting
  encrypted: false,
  description: 'Bedrock model ID for RAG query rewriting',
},
queryGenerateModel: {
  key: 'queryGenerateModel',
  defaultValue: 'us.amazon.nova-pro-v1:0',
  encrypted: false,
  description: 'Bedrock model ID for RAG answer generation',
},
queryMaxQuestionLength: {
  key: 'queryMaxQuestionLength',
  defaultValue: '1024',
  encrypted: false,
  description: 'Maximum character length for RAG questions',
},
```

Both models default to cheap options but are admin-configurable via the existing config UI. The question length limit defaults to 1024 chars.

### Step 1 — SSE event types and query types

**File:** `packages/server/src/query/types.ts` (new)

Define:

```typescript
export type RetrievedSource = {
  type: 'filing' | 'attachment' | 'pleading' | 'news';
  id: string;           // file_number, attachment_key, news item id
  title: string;        // human-readable label
  snippet: string;      // relevant excerpt
  score: number;        // RRF score
  url?: string;         // deep-link path within the app
};

export type QueryUsage = {
  rewriteTokens: { input: number; output: number };
  generateTokens: { input: number; output: number };
  retrievalMs: number;
  totalMs: number;
};

export type QuerySSEEvent =
  | { type: 'status'; stage: 'rewriting' | 'retrieving' | 'generating'; message: string }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: QueryUsage }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type RewrittenQuery = {
  text: string;
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    subsystems?: string[];
    company?: string;
    docTypes?: Array<'filing' | 'attachment' | 'pleading' | 'news'>;
  };
};
```

### Step 2 — Add `converseStream()` to BedrockClient

**File:** `packages/server/src/inference/bedrock-client.ts` (edit)

Add a new method alongside the existing `converse()`:

```typescript
import { ConverseStreamCommand, type ConverseStreamCommandInput, type ConverseStreamCommandOutput }
  from '@aws-sdk/client-bedrock-runtime';

async *converseStream(input: ConverseStreamCommandInput): AsyncGenerator<ConverseStreamEvent> {
  const response = await this.client.send(new ConverseStreamCommand(input));
  if (response.stream == null) return;
  for await (const event of response.stream) {
    yield event;
  }
}
```

Also update the `ConverseFunction` interface in `inference-service.ts` to optionally expose streaming, or keep the streaming path on `BedrockClient` directly (simpler — the `InferenceService` abstraction isn't needed for streaming since we pipe raw events).

**Test:** `packages/server/src/inference/bedrock-client.test.ts` — unit test with a mock stream that yields a few `contentBlockDelta` events and a `messageStop`.

### Step 3 — Query rewriting service

**File:** `packages/server/src/query/rewrite.ts` (new)

```typescript
export async function rewriteQuery(
  question: string,
  backend: ConverseFunction,
  modelId: string,
): Promise<{ queries: RewrittenQuery[]; usage: TokenUsage }>
```

The system prompt instructs the model to:
- Output 1–2 JSON query objects
- Expand FCC acronyms (STA, LOA, SAT, SES, etc.)
- Normalize company name variants
- Decompose multi-part questions
- Preserve file numbers verbatim
- Optionally extract filter hints (date range, subsystem, doc type)

The model ID is read from the `queryRewriteModel` config key (default: Nova Micro). The function calls `backend.converse()` (non-streaming — this step is fast and we need the full output before retrieval). Parse the JSON response, validate the structure, and return.

**Test:** `packages/server/src/query/rewrite.test.ts` — unit test with a mock backend that returns canned JSON. Test multi-part decomposition, acronym expansion, and malformed-output fallback (if the model returns bad JSON, fall back to using the original question as-is).

### Step 4 — RAG retrieval orchestrator

**File:** `packages/server/src/query/retrieve.ts` (new)

```typescript
export async function retrieveContext(
  queries: RewrittenQuery[],
  conn: DuckDBConnection,
  embeddingCtx: EmbeddingContext,
): Promise<RetrievedSource[]>
```

For each rewritten query:
1. Call the existing `searchFilingContent()` with `mode: 'hybrid'` and any extracted filters
2. Also search `news_item` via a new lightweight function (BM25 on title + full_text + summary; vector on embedding table where `source_table = 'news_item'`)
3. Merge all results across queries using RRF (reuse `mergeWithRRF` pattern or a generalized version)
4. Deduplicate by source key
5. Return top 10 results as `RetrievedSource[]`, with snippets and deep-link URLs

The news search function goes in `packages/server/src/search/content-search.ts` (or a new `news-search.ts`) since it follows the same pattern as the existing content search.

**Test:** `packages/server/src/query/retrieve.test.ts` — integration test with in-memory DuckDB. Seed a few filings + embeddings + news items, run retrieval, verify RRF merging and dedup.

### Step 5 — Answer generation with streaming

**File:** `packages/server/src/query/generate.ts` (new)

```typescript
export async function *generateAnswer(
  question: string,
  sources: RetrievedSource[],
  client: BedrockClient,
  modelId: string,
): AsyncGenerator<QuerySSEEvent>
```

Builds the answer generation prompt:
- **System prompt:** "You are an FCC filing analyst. Answer the user's question using ONLY the provided sources. Cite sources using [brackets] with the source ID. If the sources don't contain enough information, say so. Never invent facts or sources."
- **User message:** Formatted context block (each source with its type, ID, title, and snippet) followed by the question.

Calls `client.converseStream()`, yielding:
- `{ type: 'delta', text }` for each content block delta
- `{ type: 'usage', ... }` at the end with token counts from the stream metadata

**Test:** `packages/server/src/query/generate.test.ts` — unit test with a mock async generator that yields a few deltas and a stop event.

### Step 6 — SSE route

**File:** `packages/server/src/query/routes.ts` (new)

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const queryRoutes = new Hono();

// POST /api/query
queryRoutes.post('/', async (c) => {
  const { question } = await c.req.json<{ question: string }>();

  // Validate question length against configurable limit
  const maxLen: number = parseInt(config.get('queryMaxQuestionLength') as string, 10) || 1024;
  if (question.length > maxLen) {
    return c.json({ error: `Question exceeds maximum length of ${maxLen} characters` }, 400);
  }

  // Read model IDs from config
  const rewriteModelId: string = config.get('queryRewriteModel') as string;
  const generateModelId: string = config.get('queryGenerateModel') as string;

  return streamSSE(c, async (stream) => {
    const startMs = performance.now();

    // 1. Rewrite (uses cheap/fast model)
    await stream.writeSSE({ data: JSON.stringify({ type: 'status', stage: 'rewriting', message: 'Analyzing your question...' }) });
    const { queries, usage: rewriteUsage } = await rewriteQuery(question, backend, rewriteModelId);

    // 2. Retrieve
    await stream.writeSSE({ data: JSON.stringify({ type: 'status', stage: 'retrieving', message: `Searching ${queries.length} queries across filings and news...` }) });
    const sources = await retrieveContext(queries, conn, embeddingCtx);
    await stream.writeSSE({ data: JSON.stringify({ type: 'sources', sources }) });

    // 3. Generate (streaming, uses capable model)
    await stream.writeSSE({ data: JSON.stringify({ type: 'status', stage: 'generating', message: 'Generating answer...' }) });
    for await (const event of generateAnswer(question, sources, client, generateModelId)) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }

    // 4. Final usage
    const totalMs = Math.round(performance.now() - startMs);
    await stream.writeSSE({ data: JSON.stringify({ type: 'usage', usage: { rewriteTokens: rewriteUsage, generateTokens: genUsage, retrievalMs, totalMs } }) });
    await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
  });
});
```

**Mount in `app.ts`:** The route is mounted under `/api/query` which is already behind `requireAuth()` (all `/api/*` routes except public prefixes require auth). No admin requirement.

**Test:** `packages/server/src/query/routes.test.ts` — integration test that sends a POST, reads the SSE stream, and verifies the event sequence (status → sources → delta(s) → usage → done).

### Step 7 — Wire up in app.ts

**File:** `packages/server/src/app.ts` (edit)

```typescript
import { queryRoutes } from './query/routes.ts';
app.route('/api/query', queryRoutes);
```

---

## File Summary

| File | Action |
|---|---|
| `packages/server/src/lib/config-schema.ts` | Edit — add `queryRewriteModel`, `queryGenerateModel`, `queryMaxQuestionLength` |
| `packages/server/src/query/types.ts` | Create |
| `packages/server/src/query/rewrite.ts` | Create |
| `packages/server/src/query/rewrite.test.ts` | Create |
| `packages/server/src/query/retrieve.ts` | Create |
| `packages/server/src/query/retrieve.test.ts` | Create |
| `packages/server/src/query/generate.ts` | Create |
| `packages/server/src/query/generate.test.ts` | Create |
| `packages/server/src/query/routes.ts` | Create |
| `packages/server/src/query/routes.test.ts` | Create |
| `packages/server/src/inference/bedrock-client.ts` | Edit — add `converseStream()` |
| `packages/server/src/inference/bedrock-client.test.ts` | Edit — add streaming test |
| `packages/server/src/app.ts` | Edit — mount `/api/query` |

---

## Testing Strategy

- **Unit tests** for `rewrite`, `generate`, and `converseStream` — mock the Bedrock backend
- **Integration test** for `retrieve` — in-memory DuckDB with seeded data
- **Integration test** for the SSE route — full pipeline with mocked Bedrock, real DuckDB

---

## Resolved Decisions

1. **Model selection:** Both rewrite and generation models are admin-configurable via `queryRewriteModel` and `queryGenerateModel` config keys. Defaults: Nova Micro for rewriting (cheap/fast), Nova Pro for generation.
2. **News item search:** FTS index on `news_item` may already exist but no news data has been scraped yet. News retrieval integration is deferred to Session 3, after the news pipeline is populated and verified.
3. **Max question length:** Configurable via `queryMaxQuestionLength`, default 1024 chars. Validated server-side with a 400 response if exceeded.
