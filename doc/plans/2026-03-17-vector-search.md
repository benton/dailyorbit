# v1.2.0 — Vector/Semantic Search

## Context

The search system currently supports BM25 keyword search across filings, attachments, and pleadings. The UI already has "Semantic" and "Hybrid" mode selectors (marked "coming soon"). This plan adds vector similarity search using DuckDB's `vss` extension and AWS Bedrock embedding models, plus LLM attribution columns for provenance tracking.

---

## Step 1: Config Schema — add embedding config keys

**File:** `packages/server/src/lib/config-schema.ts`

Add:
- `embeddingModel` — default `amazon.titan-embed-text-v2:0`
- `embeddingDimensions` — default `512` (Titan V2 supports 256/512/1024; 512 is a good quality/speed tradeoff)
- `embeddingNormalize` — default `true` (for cosine similarity)

---

## Step 2: LLM Attribution Columns

Add to `attachment`, `filing`, and `pleading` tables:

```sql
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summarized_by VARCHAR;
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summarized_at TIMESTAMP;
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS indexed_by VARCHAR;
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP;

ALTER TABLE filing ADD COLUMN IF NOT EXISTS indexed_by VARCHAR;
ALTER TABLE filing ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP;

ALTER TABLE pleading ADD COLUMN IF NOT EXISTS indexed_by VARCHAR;
ALTER TABLE pleading ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP;
```

Update `packages/server/src/cli/inference/summarize.ts` to populate `summarized_by` and `summarized_at` when saving summaries.

The schema evolution mechanism: add an `ensureAttributionColumns(conn)` function called from `db-init.ts` that runs the ALTERs idempotently.

---

## Step 3: Embedding Table and VSS Index

**New file:** `packages/server/src/search/embedding-schema.ts`

```sql
CREATE SEQUENCE IF NOT EXISTS embedding_id_seq;

CREATE TABLE IF NOT EXISTS embedding (
  embedding_id  INTEGER PRIMARY KEY DEFAULT nextval('embedding_id_seq'),
  source_table  VARCHAR NOT NULL,       -- 'attachment', 'filing', 'pleading'
  source_key    VARCHAR NOT NULL,       -- attachment_key, file_number, pleading_key
  chunk_index   INTEGER NOT NULL DEFAULT 0,
  embedding     FLOAT[512],             -- dimension from config
  model_id      VARCHAR NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (source_table, source_key, chunk_index)
);

CREATE INDEX IF NOT EXISTS embedding_hnsw_idx
  ON embedding USING HNSW (embedding)
  WITH (metric = 'cosine');
```

Separate table is better than columns on source tables because:
- Naturally supports multiple vectors per document (future chunked embeddings)
- Decouples vector index lifecycle from source data
- Follows existing pattern of FTS indexes being separate

Add `ensureEmbeddingSchema(conn)` called from `db-init.ts`.

---

## Step 4: Bedrock Embedding Client

**File:** `packages/server/src/inference/bedrock-client.ts`

Add `embed()` method using `InvokeModelCommand` (not Converse — embedding models use a different API):

```typescript
async embed(req: EmbeddingRequest): Promise<EmbeddingResponse>
```

Titan V2 request body: `{ inputText, dimensions, normalize }`
Titan V2 response body: `{ embedding: number[], inputTextTokenCount: number }`

**New types** in `packages/server/src/inference/types.ts`:
- `EmbeddingRequest { modelId, inputText, dimensions, normalize }`
- `EmbeddingResponse { embedding: number[], inputTokenCount, latencyMs }`

---

## Step 5: Embedding Service

**New file:** `packages/server/src/inference/embedding-service.ts`

```typescript
class EmbeddingService {
  embedTexts(texts, modelId, dimensions, normalize, concurrency): Promise<EmbeddingResponse[]>
  embedQuery(query, modelId, dimensions, normalize): Promise<EmbeddingResponse>
}
```

Batch embedding with configurable concurrency, same pattern as the summarize command's `processWithConcurrency`.

---

## Step 6: Embedding Pipeline CLI Command

**New file:** `packages/server/src/cli/inference/embed.ts`
**Modify:** `packages/server/src/cli/inference/index.ts` — register `embed` subcommand

Invocation: `./daily-orbit inference embed [--source attachment|filing|pleading|all]`

Args: `database`, `region`, `model`, `dimensions`, `concurrency`, `batch`, `limit`, `dry-run`, `source`

What gets embedded per source:
- `attachment` → `summary` column (skip NULL summaries; warns if most are NULL)
- `filing` → `description` column
- `pleading` → `exhibit_attachment_html` column

Skip already-embedded rows: `WHERE source_key NOT IN (SELECT source_key FROM embedding WHERE source_table = ?)`

After embedding each row, update `indexed_by` and `indexed_at` on the source table.

Add `make embed` and `make embed-all` targets.

---

## Step 7: Vector Search Implementation

**New file:** `packages/server/src/search/vector-search.ts`

```typescript
async function searchByVector(
  conn, queryEmbedding, filters, limit
): Promise<VectorSearchHit[]>
```

Core query:
```sql
SELECT e.source_table, e.source_key,
       array_cosine_similarity(e.embedding, ?::FLOAT[512]) AS similarity
FROM embedding e
ORDER BY similarity DESC
LIMIT ?
```

Then join back to source tables for filing metadata and snippets, applying same filter clauses as BM25 search.

---

## Step 8: Hybrid Search — Reciprocal Rank Fusion

**File:** `packages/server/src/search/content-search.ts`

Refactor `searchFilingContent` to dispatch on `query.mode`:
- `keyword` → existing BM25 (unchanged)
- `semantic` → embed query via EmbeddingService, then `searchByVector`
- `hybrid` → run BM25 + vector in parallel, merge with RRF

RRF formula: `score = 1/(k + bm25_rank) + 1/(k + vector_rank)`, k=60

**New file:** `packages/server/src/search/hybrid-search.ts` for the RRF merge function.

Search routes (`packages/server/src/search/routes.ts`) need minimal changes — already pass `mode` through. Just need to provide an `EmbeddingService` instance for semantic/hybrid.

---

## Step 9: Load VSS Extension

**File:** `packages/server/src/lib/db-init.ts`

Add `INSTALL vss; LOAD vss;` in `initializeDatabase`. Also load in the embedding CLI command and rebuild-index path.

---

## Step 10: Tests (TDD alongside each step)

- `packages/server/src/inference/embedding-service.test.ts` — mock Bedrock, verify Titan V2 request/response format
- `packages/server/src/search/vector-search.test.ts` — in-memory DuckDB, known embeddings, verify cosine ranking
- `packages/server/src/search/hybrid-search.test.ts` — pure-function RRF tests with parameterized inputs

---

## Implementation Order

Parallelizable: Steps 1, 2, 4 (no dependencies)
Then: Step 3 (needs Step 1 for dimensions), Step 5 (needs Step 4), Step 9 (needs Step 3)
Then sequential: Step 6 → Step 7 → Step 8
Tests written alongside each step per TDD.

---

## Cost Estimation (current corpus in `daily-orbit-after-text-extraction.duckdb`)

**Titan Embeddings V2 pricing:** $0.00002 / 1,000 input tokens

| Source | Rows | Total chars | Est. tokens | Est. cost |
|--------|------|-------------|-------------|-----------|
| attachment.summary | 0 (need summarization first) | — | ~55M (projected) | ~$1.10 |
| filing.description | 132,962 | 5.1M | 1.3M | $0.03 |
| pleading.html | 27,294 | 4.5M | 1.1M | $0.02 |
| **Total v1** | | | | **~$1.15** |
| attachment.full_text (v2, chunked) | 110,896 | 1.17B | 292M | $5.72 |

Embedding cost is negligible. The prerequisite summarization step (Nova Pro) is the dominant cost.

---

## Verification

1. `pnpm test` — all new and existing tests pass
2. `./daily-orbit inference embed --source filing --dry-run` — shows what would be embedded, no API calls
3. `./daily-orbit inference embed --source filing --limit 10` — embed 10 filing descriptions, verify rows in `embedding` table
4. `./daily-orbit search rebuild-index` — still works (FTS unaffected)
5. Manual: search UI with mode=semantic returns results ranked by vector similarity
6. Manual: search UI with mode=hybrid returns RRF-merged results
7. Check attribution columns: `SELECT indexed_by, indexed_at FROM filing WHERE indexed_by IS NOT NULL LIMIT 5`
