# Plan: Map-Reduce Chunked Summarization

**Date:** 2026-03-17
**Status:** Proposed

## Problem

The batch summarization pipeline (`./daily-orbit inference summarize`) fails on
~26% of remaining attachments (376 of 1,450). The Bedrock API returns:

```
Too many tokens, please wait before trying again.
```

Every failing document has `text_length >= 100,420` characters. The effective
per-request input limit appears to be around 100k characters (~25k tokens),
well below Nova Pro's advertised 300k-token context window. This may be an
account-level or provisioned-throughput limit rather than a model limit.

## Data Profile

All 376 unsummarized attachments exceed the failure threshold:

| Bucket     | Docs | Min chars   | Max chars   |
|------------|------|-------------|-------------|
| 100k–200k  | 227  | 100,420     | 199,762     |
| 200k–500k  | 114  | 200,597     | 460,191     |
| 500k–1M    |  33  | 511,123     | 787,765     |
| 1M+        |   2  | 1,298,942   | 2,930,895   |

Already-summarized corpus (111,416 docs): median text length 5,300 chars,
p99 at 57,510 chars — all well under the limit.

## Cost Estimate

Using **80k-char chunks** (~20k tokens, conservative headroom) with
Nova Pro pricing ($0.80/1M input, $3.20/1M output):

| Phase                          | API calls | Input tokens | Output tokens | Cost     |
|--------------------------------|-----------|--------------|---------------|----------|
| Map (chunk summaries)          | 1,340     | ~23.0M       | ~686K         | $20.60   |
| Reduce (merge sub-summaries)   | 376       | ~536K        | ~193K         | $1.05    |
| **Total**                      | **1,716** | **~23.5M**   | **~879K**     | **~$21.65** |

If these 376 docs could have been summarized in single calls, the cost would
have been ~$18.80. Chunking overhead is ~$2.85 (~15%).

At 10 concurrency and ~3.9 s/call, the 1,716 calls take roughly **11 minutes**.

## Algorithm

```
summarizeOne(row):
  SAFE_CHAR_LIMIT = 80_000

  if row.fullText.length <= SAFE_CHAR_LIMIT:
    return directSummarize(row)       # existing path, unchanged

  # MAP: split text into chunks, summarize each independently
  chunks = splitText(row.fullText, SAFE_CHAR_LIMIT)
  subSummaries: string[] = []
  for (i, chunk) of chunks:
    subSummary = callModel(CHUNK_SYSTEM_PROMPT, CHUNK_USER_PROMPT, {
      ...row.metadata,
      fullText: chunk,
      chunkIndex: i + 1,
      totalChunks: chunks.length,
    })
    subSummaries.push(subSummary)

  # REDUCE: combine sub-summaries into one coherent final summary
  return callModel(REDUCE_SYSTEM_PROMPT, REDUCE_USER_PROMPT, {
    ...row.metadata,
    subSummaries: subSummaries.join('\n\n'),
  })
```

## Text Splitting Strategy

`splitText(text, maxChars)` splits on **paragraph boundaries** (double newline),
accumulating until the next paragraph would exceed the limit.

Fallback order:
1. Paragraph boundary (double newline)
2. Sentence boundary (`. ` / `.\n`)
3. Hard character split (last resort)

**Overlap:** 500 chars from the end of chunk N are prepended to chunk N+1, so
the model has context continuity at boundaries.

## Prompt Templates

### Chunk prompt (map phase)

```
Summarize part {{chunkIndex}} of {{totalChunks}} of the following FCC filing
attachment. This is a section of a larger document, so focus on capturing all
substantive content in this section. Do not introduce or conclude the overall
filing — just summarize what this section contains.

Filing: {{fileNumber}} | Filed by: {{applicantName}} | Date: {{dateFiled}}
Type: {{appTypeCode}} | Subsystem: {{subsystemCode}}

--- Begin section {{chunkIndex}} of {{totalChunks}} ---
{{fullText}}
--- End section ---
```

### Reduce prompt (merge phase)

```
The following are partial summaries of different sections of a single FCC filing
attachment. Combine them into one cohesive summary of one to two paragraphs.
Focus on: what is being requested or proposed, by whom, and any notable technical
parameters or regulatory conditions.

Filing: {{fileNumber}} | Filed by: {{applicantName}} | Date: {{dateFiled}}
Type: {{appTypeCode}} | Subsystem: {{subsystemCode}}

--- Partial summaries ---
{{subSummaries}}
--- End partial summaries ---
```

## Implementation

### Files to create

| File | Purpose |
|------|---------|
| `packages/server/src/inference/text-chunker.ts` | `splitText()` utility |
| `packages/server/src/inference/text-chunker.test.ts` | Unit tests for splitting |

### Files to modify

| File | Change |
|------|--------|
| `packages/server/src/inference/prompts.ts` | Add `CHUNK_USER_PROMPT`, `REDUCE_USER_PROMPT`, new template variables (`chunkIndex`, `totalChunks`, `subSummaries`) |
| `packages/server/src/cli/inference/summarize.ts` | Add length check in `summarizeOne()`; delegate to `summarizeChunked()` for large texts; add `--chunk-size` CLI arg (default 80000) |

### What stays the same

- Batch orchestration, concurrency control, DB schema, progress reporting,
  error handling
- Docs under 80k chars (~99.6% of total corpus) take the existing code path
- The `sample-summarize` command (already filters to 1k–50k chars)

## Design Decisions

- **80k char threshold** (not 100k): leaves ~20% headroom below the observed
  failure point. The prompt template adds ~300 chars of metadata framing, plus
  the system prompt, so the actual token count is higher than `text / 4`.
- **Paragraph-aware splitting**: avoids cutting mid-sentence, which would
  confuse the summarizer. Legal filings tend to have clear paragraph structure.
- **No retry on map phase**: if one chunk fails, the whole doc fails — same as
  today's single-call behavior. The batch continues to the next doc.
- **Same model for map and reduce**: keeps pricing predictable, avoids
  model-switching complexity.
- **`--chunk-size` CLI arg**: allows operational tuning if Bedrock limits change
  or if we switch models, without code changes.

## Open Questions

- Is the ~100k char limit a provisioned-throughput constraint or an account
  setting? If it can be raised via AWS support, chunking may become unnecessary
  for most of the 227 docs in the 100k–200k range.
- Should we persist chunk-level sub-summaries for debugging/auditability, or
  is the final merged summary sufficient?
