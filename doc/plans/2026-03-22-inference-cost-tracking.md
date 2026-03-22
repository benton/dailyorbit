# Plan: Inference Cost Tracking

## Context

All LLM inference calls go through AWS Bedrock but there's no persistent record of token usage or costs. The chat module has `cost_cents` columns but they're hardcoded to 0. Batch CLI commands (summarize, embed) print usage stats to stdout but don't persist them. We need a central `inference_log` table that captures every Bedrock call automatically.

---

## Architecture: Where Inference Happens

There are **4 call paths** to Bedrock:

| Path | Entry point | Used by |
|------|------------|---------|
| Non-streaming completions | `InferenceService.complete()` | Summarization CLI, inference test route |
| Streaming completions | `BedrockClient.converseStream()` | RAG answer generation (`query/generate.ts`), chat routes |
| Embeddings | `EmbeddingService.embedQuery()`/`embedTexts()` via `BedrockClient.embed()` | Embedding CLI, search-time query embedding |
| Direct converse | `backend.converse()` in `rewriteQuery()` | Query rewriting |

**Key insight:** Paths 1 and 4 both go through `BedrockClient.converse()`. Path 2 goes through `BedrockClient.converseStream()`. Path 3 goes through `BedrockClient.embed()`. Instrumenting the **3 methods on `BedrockClient`** captures everything.

---

## Implementation Steps

### Step 1: Create `inference_log` table + schema

New file: `packages/server/src/inference/schema.ts`

```sql
CREATE SEQUENCE IF NOT EXISTS inference_log_id_seq START 1;
CREATE TABLE IF NOT EXISTS inference_log (
  id              INTEGER NOT NULL DEFAULT nextval('inference_log_id_seq') PRIMARY KEY,
  model_id        VARCHAR NOT NULL,
  operation       VARCHAR NOT NULL,  -- 'converse', 'converse_stream', 'embed'
  caller          VARCHAR,           -- optional tag: 'summarize', 'embed_cli', 'chat', 'query_rewrite', 'query_generate', etc.
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_inference_log_created ON inference_log(created_at);
CREATE INDEX IF NOT EXISTS idx_inference_log_model ON inference_log(model_id);
CREATE INDEX IF NOT EXISTS idx_inference_log_caller ON inference_log(caller);
```

Wire `ensureInferenceLogTable()` into `db-init.ts`.

### Step 2: Create `InferenceLogRepository`

New file: `packages/server/src/inference/log-repository.ts`

A simple repository with:
- `log(entry)` — insert a single row
- `logBatch(entries)` — batch insert (for CLI commands that accumulate many calls)
- `summarize(from?, to?)` — aggregate query for admin dashboard (total tokens, cost by model, by caller)

Accepts a `DuckDBConnection` (matching existing patterns).

### Step 3: Instrument `BedrockClient` via a wrapping decorator

New file: `packages/server/src/inference/instrumented-client.ts`

Create `InstrumentedBedrockClient` that wraps a `BedrockClient` and logs each call:

- **`converse()`** — logs after response, extracting usage from `ConverseCommandOutput`
- **`converseStream()`** — wraps the async generator, logs usage from the metadata event at the end
- **`embed()`** — logs `inputTokenCount` from the response

Each method accepts an optional `caller` tag via a `caller` property on the instance. This approach means **zero changes to `InferenceService`, `EmbeddingService`, `rewriteQuery()`, or `generateAnswer()`** — they all receive the instrumented client and logging is transparent.

### Step 4: Wire up the instrumented client

Modify `packages/server/src/inference/index.ts`:
- `getInferenceService()` creates `InstrumentedBedrockClient` instead of plain `BedrockClient`
- The instrumented client gets a DB connection via the same lazy singleton pattern

Modify call sites to set the `caller` tag:
- `summarize.ts` CLI → `'summarize'`
- `embed.ts` CLI → `'embed_cli'`
- `query/generate.ts` → `'query_generate'`
- `query/rewrite.ts` → `'query_rewrite'`
- `chat/routes.ts` → `'chat'`
- `inference/routes.ts` → `'inference_test'`

The `caller` tag is optional — calls without it still get logged with `caller = NULL`.

### Step 5: Pricing / cost calculation

New file: `packages/server/src/inference/pricing.ts`

Add `computeCost(modelId, inputTokens, outputTokens)` with a static pricing table for models in use (Nova Pro, Nova Micro, Haiku, Titan Embed). Used to:
- Replace the hardcoded `costCents: 0` in `chat/routes.ts`
- Power cost aggregation in `InferenceLogRepository.summarize()`

### Step 6: Tests

- **`log-repository.test.ts`** — in-memory DuckDB, verify insert + aggregate query
- **`instrumented-client.test.ts`** — mock inner client, verify log entries are written for each operation
- **`pricing.test.ts`** — verify cost calculation for known models

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/server/src/inference/schema.ts` | Table DDL |
| `packages/server/src/inference/log-repository.ts` | Repository |
| `packages/server/src/inference/instrumented-client.ts` | Logging wrapper |
| `packages/server/src/inference/pricing.ts` | Cost calculation |
| `packages/server/src/inference/log-repository.test.ts` | Tests |
| `packages/server/src/inference/instrumented-client.test.ts` | Tests |
| `packages/server/src/inference/pricing.test.ts` | Tests |

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/lib/db-init.ts` | Add `ensureInferenceLogTable()` |
| `packages/server/src/inference/index.ts` | Use instrumented client in singleton |
| `packages/server/src/cli/inference/summarize.ts` | Set caller tag |
| `packages/server/src/cli/inference/embed.ts` | Set caller tag |
| `packages/server/src/query/generate.ts` | Set caller tag |
| `packages/server/src/chat/routes.ts` | Set caller tag, use `computeCost()` |

---

## Verification

1. `make test` — all existing + new tests pass
2. `./daily-orbit db init` on a fresh DB — verify `inference_log` table exists
3. `./daily-orbit inference summarize --limit 2` — verify rows appear in `inference_log`
4. DuckDB query: `SELECT model_id, caller, SUM(input_tokens), COUNT(*) FROM inference_log GROUP BY 1, 2`
