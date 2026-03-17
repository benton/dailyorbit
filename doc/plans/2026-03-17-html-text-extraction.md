# Plan: HTML Attachment Text Extraction

**Date:** 2026-03-17
**Status:** Draft

## Context

Content-type validation (just deployed) revealed that **69,035 HTML files** were previously invisible to extraction because the FCC served them with `Content-Type: application/pdf`. These are now correctly identified as `text/html` but the extraction pipeline only handles `application/pdf`, `text/plain`, and `text/csv`.

Sampling shows the HTML falls into three categories:

| Category | Est. Count | Avg Size | Content |
|---|---|---|---|
| FCC application forms (OMB 3060-0678) | ~50k | 10-50KB | HTML tables with application details, Schedule S data, technical parameters |
| USPTO patents | ~3k | 50-200KB | Full patent text filed as supporting evidence |
| Withdrawal receipts | ~2.4k | 2-5KB | Official FCC withdrawal confirmations with file number, applicant, dates |
| FCC narratives/exhibits | ~3k | 20-35KB | STA requests, Exhibit A-D, rad hazard reports, frequencies |
| Auth failure stubs | ~10k | 110-300B | "Webpage not available" / "Auth Failed" / "Could not resolve host" |
| Other named HTML | ~500 | varies | KMZ, CFM, miscellaneous |

**Key finding:** ~85% of the HTML is real filed FCC content that should be extracted, indexed, and summarized. The ~15% auth-failure stubs are download failures (tiny files with error text) that should be flagged and excluded.

### Other non-PDF types (for awareness, not in this plan's scope)

| Type | Count | Content | Action |
|---|---|---|---|
| `application/x-wine-extension-ini` | 10,239 | GXT satellite antenna gain patterns (INI format) | Technical data, not prose — skip extraction |
| `application/octet-stream` | 3,661 | Unknown binary | Skip extraction |
| `application/zip` | 470 | Zip archives | Skip extraction |
| `application/msword` | 276 | Word documents | Future: extract with pandoc or similar |
| `application/vnd.ms-excel` | 31 | Excel files | Future: extract with appropriate tool |
| Others (rtf, docx, xlsx, jpg, tiff, 7z, eml) | ~36 | Various | Skip extraction |

---

## Approach

### 1. HTML-to-text extraction function

**New file: `packages/server/src/attachments/extract-html.ts`**

Use an existing dependency or lightweight approach to strip HTML tags and extract readable text. Options:

- **Option A (recommended):** Use `htmlparser2` + `dom-serializer` (already in the dependency tree via Cheerio, which is used by `html-parser.ts`) — parse HTML, walk the DOM, extract text nodes, collapse whitespace
- **Option B:** Simple regex strip — `html.replace(/<[^>]+>/g, ' ')` then collapse whitespace. Crude but effective for the table-heavy FCC HTML. Risk: script tags, style tags leaking through
- **Option C:** Use `linkedom` or `jsdom` for full DOM parsing — heavier but more correct

**Recommendation:** Option A. We already depend on `cheerio` (see `packages/server/src/attachments/html-parser.ts`), so using it to extract text is zero new dependencies and handles edge cases (script/style stripping, entity decoding).

```typescript
export function extractTextFromHtml(html: string): ExtractionResult
```

- Load HTML with cheerio
- Remove `<script>`, `<style>`, `<noscript>` elements
- Extract `.text()` from the body (or root if no body)
- Collapse whitespace
- Apply same MIN_TEXT_CHARS threshold as PDF extraction (50 chars)

### 2. Auth-failure stub detection

Before HTML text extraction, detect and skip auth-failure stubs. These are identifiable by:

- File size < 500 bytes AND
- Content matches known error patterns: "Webpage not available", "Auth Failed", "Could not resolve host"

**New extract status:** `skipped_auth_error` — distinguishes download failures from genuine empty documents. This lets us potentially re-download these files later if auth becomes available.

Add to `markExtractionSkipped` reason union:
```typescript
'skipped_no_text' | 'skipped_not_pdf' | 'skipped_auth_error'
```

### 3. Wire HTML into extraction pipeline

**Modify: `packages/server/src/attachments/repository.ts`**

Update `getPendingExtractions` content-type filter:
```sql
AND content_type IN ('application/pdf', 'text/plain', 'text/csv', 'text/html')
```

**Modify: `packages/server/src/attachments/extract-pipeline.ts` and `pipeline.ts`**

Add HTML branch to the content-type dispatch:

```typescript
if (row.contentType === 'text/html') {
  const html = readFileSync(row.localPath, 'utf-8');
  // Check for auth-failure stub
  if (fileSizeBytes < 500 && looksLikeAuthError(html)) {
    markExtractionSkipped(conn, row.attachmentKey, 'skipped_auth_error');
  } else {
    const result = extractTextFromHtml(html);
    // ... same extracted/skipped_no_text/failed logic
  }
}
```

### 4. Tests

**New file: `packages/server/src/attachments/extract-html.test.ts`**

- Real FCC OMB form HTML → extracts table content as text
- USPTO patent HTML → extracts patent text
- Withdrawal receipt → extracts filing details
- Auth failure stub → returns skipped/failed appropriately
- Empty HTML → skipped_no_text
- HTML with only script/style → skipped_no_text

**Modify: `packages/server/src/attachments/repository.test.ts`**

- `getPendingExtractions` includes `text/html` rows

### 5. Update pipeline documentation

**Modify: `doc/ingestion-pipeline.md`**

- Stage 2d description: add HTML extraction alongside PDF and text
- Update the content-type list in the text extraction flow

### 6. Run extraction on the 69k HTML files

After deploying the code changes:
```bash
# Reset any failed extractions from previous attempts
# (the 778 we already reset, plus any new ones)
./daily-orbit attachments extract --verbose --limit 100  # smoke test
./daily-orbit attachments extract                         # full run
```

---

## Execution Order

1. `extract-html.ts` — the core function
2. `extract-html.test.ts` — TDD: tests first or alongside
3. Repository changes — add `text/html` to extractable types, add `skipped_auth_error`
4. Pipeline changes — wire HTML branch into both pipelines
5. Repository tests — update for new content type
6. Doc update — `ingestion-pipeline.md`
7. Smoke test on real data — `--limit 100`
8. Full extraction run

## Verification

1. `pnpm test` — all tests pass
2. `pnpm --filter @daily-orbit/server build` — clean build
3. `./daily-orbit attachments extract --verbose --limit 100` — extracts HTML, skips auth stubs
4. Check DB: `SELECT extract_status, COUNT(*) FROM attachment WHERE content_type = 'text/html' GROUP BY extract_status`

## Open Questions

1. **Should we strip the HTML or keep it as-is for search?** Stripping is better for summarization (LLM prompt), but the raw HTML might be useful for structured parsing later. Recommendation: store stripped text in `full_text` (same as PDF), keep original HTML on disk.

2. **Should the GXT/INI files be extracted?** They contain structured satellite configuration data. Not useful for LLM summarization, but could be valuable for technical search. Deferring to a future plan.

3. **Word/Excel extraction?** Only ~307 files total. Low priority but could add `pandoc`-based extraction later. Deferring.
