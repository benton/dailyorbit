# Plan: pdftotext Fallback Extraction & Binary Content Remediation

## Problem

The WASM PDF extractor (`pdf-oxide-wasm`) silently returns raw binary content
for ~51 attachments instead of extracted text. These pass the `MIN_TEXT_CHARS`
threshold (binary has plenty of non-whitespace bytes) and get stored in
`full_text` as garbage. Of these, 71 already have junk summaries generated
from the binary content.

## Root Cause

`pdf-oxide-wasm`'s `toMarkdown()` does not throw on certain malformed or
complex PDFs — it returns the raw byte stream as a string. The current
extraction pipeline has no post-extraction validation, so this binary content
flows through to `full_text` and eventually to the summarizer.

## Fix: Two Parts

### Part 1 — Binary Detection + pdftotext Fallback

**File: `packages/server/src/attachments/extract-text.ts`**

1. Add `looksLikeBinary(text: string): boolean` — exported, pure function
   - Returns `true` if `text.startsWith('%PDF-')`
   - Returns `true` if >10% of non-whitespace chars are non-printable
     (outside ASCII 0x20–0x7E plus common Unicode letter ranges)
   - This is a heuristic; the threshold may need tuning

2. Add `extractWithPdftotext(filePath: string): ExtractionResult`
   - Calls `pdftotext -layout <filePath> -` via `execFileSync`
   - Captures stdout, splits on form-feed `\f` for page breaks
   - Joins pages with `\n\n---\n\n` separator (same as WASM path)
   - Applies same `MIN_TEXT_CHARS` check
   - Throws with clear error if `pdftotext` binary is not found
   - Timeout: 60s, max buffer: 50MB

3. Update `extractTextFromPdf(bytes, filePath?)` signature
   - Add optional `filePath` parameter (needed for pdftotext invocation)
   - After WASM extraction succeeds, check `looksLikeBinary(result.text)`
   - If binary AND `filePath` provided: try `extractWithPdftotext`
   - If pdftotext also fails: return `status: 'failed'` with both errors
   - If `filePath` not provided: return `status: 'failed'` noting binary

4. Refactor existing WASM logic into private `extractWithWasm(bytes)` for clarity

**File: `packages/server/src/attachments/extract-pipeline.ts`**

5. Pass `row.localPath` to `extractTextFromPdf(bytes, row.localPath)` so
   the fallback path is available

**File: `packages/server/src/attachments/pipeline.ts`**

6. Same change at the pipeline's Stage 5 call site

### Part 2 — Tests

**File: `packages/server/src/attachments/extract-text.test.ts`**

New unit tests for `looksLikeBinary`:
- Returns `true` for `%PDF-1.4...` prefix
- Returns `true` for string with >10% non-printable chars
- Returns `false` for normal English text
- Returns `false` for text with markdown formatting and Unicode
- Returns `false` for empty string
- Edge case: text at exactly the 10% threshold

Existing integration tests should continue to pass — the WASM path is
unchanged for PDFs that extract cleanly. The `filePath` parameter is optional
so existing callers without it still work (they just won't get the fallback).

### Part 3 — Database Remediation

A one-time CLI script or SQL migration to fix the 51+71 affected rows:

**Option A: SQL script (preferred for speed)**

```sql
-- Clear bad summaries generated from binary full_text
UPDATE attachment
SET summary = NULL, summarized_by = NULL, summarized_at = NULL
WHERE full_text IS NOT NULL
  AND left(full_text, 5) = '%PDF-'
  AND summary IS NOT NULL;

-- Reset extraction status so the pipeline re-extracts with fallback
UPDATE attachment
SET full_text = NULL,
    text_length = NULL,
    extract_status = 'failed'
WHERE full_text IS NOT NULL
  AND left(full_text, 5) = '%PDF-';
```

**Option B: Broader remediation using looksLikeBinary**

After deploying Part 1, run a script that:
1. Queries all `extract_status = 'extracted'` rows
2. Checks `looksLikeBinary(full_text)` on each
3. Resets matching rows (same fields as Option A)
4. Re-runs `daily-orbit data extract --retry-failed`

Option B catches cases where binary content doesn't start with `%PDF-` but
is still garbage. More thorough, slightly more work.

## Execution Order

1. Write tests for `looksLikeBinary` (TDD)
2. Implement `looksLikeBinary` and `extractWithPdftotext`
3. Update `extractTextFromPdf` signature and fallback logic
4. Update callers (`extract-pipeline.ts`, `pipeline.ts`) to pass `filePath`
5. Run full test suite
6. Run remediation SQL (Option A) against production DB
7. Re-run `daily-orbit data extract --retry-failed` to re-extract the 51 rows
8. Re-run `daily-orbit inference summarize` to regenerate the 71 cleared summaries

## Dependencies

- `pdftotext` must be installed (poppler-utils). Already present on dev machine.
- For deployment: add `poppler-utils` to the container image or document as
  a runtime prerequisite.

## Risk

- `pdftotext` produces plain text, not markdown. Summaries from fallback
  extractions will lack heading structure but content will be correct.
- The binary detection heuristic is tunable. 10% threshold is conservative —
  normal legal text has <1% non-printable chars. May need adjustment if
  we encounter PDFs with lots of math symbols or non-Latin scripts.
