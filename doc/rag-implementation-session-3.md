# RAG Implementation — Session 3: News Retrieval, Evaluation, and Polish

**Depends on:** [Session 1](rag-implementation-session-1.md) + [Session 2](rag-implementation-session-2.md)
**Produces:** News article retrieval in the RAG pipeline, an evaluation harness, and end-to-end polish.

---

## Scope

Session 1 builds the pipeline with filing/attachment/pleading retrieval. Session 2 builds the frontend. This session:

1. Adds news article retrieval to the RAG pipeline
2. Builds a curated evaluation set
3. Builds an automated evaluation harness (retrieval quality + answer quality)
4. End-to-end testing
5. Performance tuning and prompt refinement

---

## Implementation Steps

### Step 1 — News item search integration

**File:** `packages/server/src/search/news-search.ts` (new)

```typescript
export async function searchNewsByKeyword(
  conn: DuckDBConnection,
  query: string,
  limit: number,
): Promise<NewsSearchHit[]>

export async function searchNewsByVector(
  conn: DuckDBConnection,
  embedding: number[],
  limit: number,
): Promise<NewsSearchHit[]>

export type NewsSearchHit = {
  news_item_id: number;
  title: string;
  source_name: string;
  published_at: string | null;
  snippet: string;
  score: number;
  source_url: string;
  company_name: string | null;
};
```

BM25 search requires an FTS index on `news_item`. Check if one exists; if not, create it:

```sql
PRAGMA create_fts_index('news_item', 'id', 'title', 'full_text', 'summary');
```

Vector search queries the existing `embedding` table where `source_table = 'news_item'`.

**Test:** `packages/server/src/search/news-search.test.ts` — in-memory DuckDB with seeded news items and embeddings.

### Step 2 — Integrate news into retrieve.ts

**File:** `packages/server/src/query/retrieve.ts` (edit)

Update `retrieveContext()` to:
1. Run filing content search (existing) and news search (new) in parallel for each rewritten query
2. Convert `NewsSearchHit` to `RetrievedSource` with `type: 'news'`
3. Merge all results (filings + news) via RRF
4. Deduplicate and return top K

### Step 3 — FTS index migration for news_item

**File:** `packages/server/src/news/schema.ts` (edit, or new migration)

Ensure the FTS index is created as part of the news schema setup, matching the pattern used for filing content FTS.

### Step 4 — Evaluation dataset

**File:** `packages/server/src/query/eval/dataset.json` (new)

A curated set of ~50 question/expected-source pairs, organized by category:

```json
[
  {
    "id": "factual-001",
    "category": "single-filing-lookup",
    "question": "What is the status of SAT-LOA-20240701-00011?",
    "expected_sources": ["SAT-LOA-20240701-00011"],
    "notes": "Should retrieve the filing directly by file number"
  },
  {
    "id": "comparative-001",
    "category": "cross-filing",
    "question": "Which companies have filed for NGSO constellation authority in 2024?",
    "expected_sources": ["SAT-LOA-*"],
    "notes": "Should retrieve multiple SAT-LOA filings with NGSO references"
  },
  {
    "id": "insufficient-001",
    "category": "should-decline",
    "question": "What is the weather forecast for Washington DC?",
    "expected_sources": [],
    "notes": "Should return 'insufficient data' - no relevant sources"
  }
]
```

Categories:
- `single-filing-lookup` — factual questions about one filing
- `cross-filing` — comparative questions across filings
- `temporal` — "what changed since..." questions
- `company-centric` — questions about a company's activity
- `attachment-content` — questions requiring attachment text
- `news-related` — questions about industry news
- `should-decline` — questions the system should refuse to answer from corpus

### Step 5 — Evaluation harness

**File:** `packages/server/src/query/eval/evaluate.ts` (new)

A CLI-invocable script (wired as `./daily-orbit query eval`) that:

1. Loads the evaluation dataset
2. For each question:
   a. Runs the query rewriting step
   b. Runs retrieval
   c. Computes **Recall@10** against expected sources
   d. Runs answer generation
   e. Uses an LLM-as-judge call to score **faithfulness** (1–5) and **completeness** (1–5)
3. Outputs a summary report:
   - Mean Recall@10
   - Mean Reciprocal Rank
   - Mean faithfulness score
   - Mean completeness score
   - Per-category breakdowns
   - List of failures (low recall or low faithfulness)

**File:** `packages/server/src/cli/query.ts` (new or edit existing CLI)

Wire the eval command:
```
./daily-orbit query eval [--dataset path] [--model modelId] [--verbose]
```

### Step 6 — End-to-end test

**File:** `packages/server/src/query/e2e.test.ts` (new)

A single end-to-end test that:
1. Seeds an in-memory DuckDB with realistic data (a few filings, attachments, news items, embeddings)
2. Sends a POST to `/api/query` with a question
3. Reads the full SSE stream
4. Verifies: status events appear in order, sources are non-empty, answer text is non-empty and contains at least one citation bracket, usage event has non-zero token counts, done event terminates the stream

This test uses mocked Bedrock (for deterministic output) but real DuckDB (for realistic retrieval).

### Step 7 — Prompt refinement

Based on evaluation results, iterate on:
- **Rewrite prompt:** Improve acronym expansion, filter extraction accuracy
- **Generation prompt:** Improve citation format compliance, reduce hallucination, improve "I don't know" calibration
- **Retrieval parameters:** Tune top-K, RRF k parameter, BM25 vs. vector weighting

This is an empirical step — run the eval, identify failure modes, adjust prompts, re-run.

### Step 8 — Performance tuning

Measure and optimize:
- **Rewrite latency:** If too slow, switch to a faster model (Nova Micro) for rewriting
- **Retrieval latency:** Profile the DuckDB queries; ensure HNSW index is used for vector search
- **Streaming responsiveness:** Measure time-to-first-token for the answer stream
- **Total query latency:** Target < 5s for the full pipeline (rewrite + retrieve + first answer token)

---

## File Summary

| File | Action |
|---|---|
| `packages/server/src/search/news-search.ts` | Create |
| `packages/server/src/search/news-search.test.ts` | Create |
| `packages/server/src/query/retrieve.ts` | Edit — add news retrieval |
| `packages/server/src/news/schema.ts` | Edit — add FTS index |
| `packages/server/src/query/eval/dataset.json` | Create |
| `packages/server/src/query/eval/evaluate.ts` | Create |
| `packages/server/src/cli/query.ts` | Create — eval CLI command |
| `packages/server/src/query/e2e.test.ts` | Create |

---

## Future Work (Not In Scope)

These are explicitly deferred and can be bolted on later:

- **Per-user cost attribution** — Track token usage per user per query. Requires a `query_log` table with user ID, token counts, and timestamps. Straightforward to add once the pipeline is stable.
- **Multi-turn conversation** — Maintain conversation history for follow-up questions. Requires session management and context window budgeting.
- **Reranking** — Add cross-encoder or LLM reranking between retrieval and generation if evaluation shows precision problems.
- **Query history** — Store past queries and answers for user reference.
- **Feedback loop** — Let users thumbs-up/down answers to build training signal.
