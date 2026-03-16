# v0.4.0 — PDF Text Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract text from downloaded PDF attachments using `pdf-oxide-wasm` and persist the markdown-formatted text into the existing `full_text` column.

**Architecture:** A new extraction stage is added to the attachment pipeline, running after download. It reads each downloaded PDF from disk, extracts per-page markdown via `pdf-oxide-wasm`, concatenates the pages, and writes the result to the `attachment` table. Scanned/image-only PDFs (< 50 non-whitespace chars after extraction) are marked `skipped_no_text` rather than failed. A new `extract_status` column tracks extraction state independently of download state.

**Tech Stack:** `pdf-oxide-wasm` (WASM-based PDF parser with `toMarkdown()` API), DuckDB, Citty CLI, Vitest.

---

## Background

- 135K PDF attachments stored at `data/attachments/{subsystem}/{fileNumber}/{attachmentKey}.pdf`
- Sampling shows ~83% contain extractable text, ~15% are scanned images, ~2% errors
- The `attachment` table already has `full_text TEXT`, `text_length INTEGER`, and `summary TEXT` columns (currently unpopulated)
- `pdf-oxide-wasm` API: `new WasmPdfDocument(Uint8Array)` → `.pageCount()` → `.toMarkdown(pageIndex, detectHeadings, includeImages)` → `.free()`
- Use `include_images=false` to avoid base64 noise from scanned docs

---

## Task 1: Move `pdf-oxide-wasm` to server package and add `extract_status` column

**Files:**
- Modify: `packages/server/package.json` — add `pdf-oxide-wasm` dependency
- Modify: `package.json` — remove workspace-root `pdf-oxide-wasm` dependency
- Modify: `packages/server/src/attachments/repository.ts` — add `extract_status` column, migration, and query functions
- Test: `packages/server/src/attachments/repository.test.ts`

### Step 1: Move the dependency

Move `pdf-oxide-wasm` from the workspace root `package.json` to `packages/server/package.json`:

```bash
cd /Users/benton/code/daily-orbit
# Remove from workspace root
pnpm remove -w pdf-oxide-wasm
# Add to server package
pnpm add --filter @daily-orbit/server pdf-oxide-wasm
```

### Step 2: Add `extract_status` column and migration

In `packages/server/src/attachments/repository.ts`, add the new column to the schema:

**`CREATE_TABLE_SQL`** — add after the `summary TEXT` line:
```sql
extract_status VARCHAR NOT NULL DEFAULT 'pending'
```

**`MIGRATE_COLUMNS_SQL`** — add:
```sql
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS extract_status VARCHAR NOT NULL DEFAULT 'pending'
```

Valid `extract_status` values: `'pending'`, `'extracted'`, `'skipped_no_text'`, `'skipped_not_pdf'`, `'failed'`.

### Step 3: Write failing test for `getPendingExtractions`

In `packages/server/src/attachments/repository.test.ts`, add a new `describe('getPendingExtractions')` block:

```typescript
describe('getPendingExtractions', () => {
  beforeEach(async () => {
    // Seed a downloaded PDF attachment
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, extract_status)
       VALUES
        (100, 1, 'SAT-STA-20230614-00142', 'Narrative', 'https://example.com/100.pdf',
         'downloaded', 'application/pdf', '/tmp/100.pdf', 'pending'),
        (101, 1, 'SAT-STA-20230614-00142', 'Tech Report', 'https://example.com/101.pdf',
         'downloaded', 'application/pdf', '/tmp/101.pdf', 'extracted'),
        (102, 1, 'SAT-STA-20230614-00142', 'Photo', 'https://example.com/102.html',
         'downloaded', 'text/html', '/tmp/102.html', 'pending'),
        (103, 1, 'SAT-STA-20230614-00142', 'Pending DL', 'https://example.com/103.pdf',
         'pending', 'application/pdf', NULL, 'pending')`
    );
  });

  it('returns only downloaded PDFs with pending extract_status', async () => {
    const rows = await getPendingExtractions(conn);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attachmentKey).toEqual(100);
  });

  it('includes failed extractions when retryFailed is true', async () => {
    await conn.run(
      `UPDATE attachment SET extract_status = 'failed' WHERE attachment_key = 100`
    );
    const rows = await getPendingExtractions(conn, { retryFailed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attachmentKey).toEqual(100);
  });

  it('respects limit parameter', async () => {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, extract_status)
       VALUES (104, 1, 'SAT-STA-20230614-00142', 'Another', 'https://example.com/104.pdf',
         'downloaded', 'application/pdf', '/tmp/104.pdf', 'pending')`
    );
    const rows = await getPendingExtractions(conn, { limit: 1 });
    expect(rows).toHaveLength(1);
  });
});
```

### Step 4: Run test to verify it fails

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/repository.test.ts
```

Expected: FAIL — `getPendingExtractions` is not defined.

### Step 5: Implement `getPendingExtractions` and `markExtracted`

In `packages/server/src/attachments/repository.ts`:

```typescript
export type PendingExtractionRow = {
  attachmentKey: number;
  localPath: string;
  contentType: string;
};

export type ExtractionQueryOptions = {
  retryFailed?: boolean;
  limit?: number;
};

export async function getPendingExtractions(
  conn: DuckDBConnection,
  options: ExtractionQueryOptions = {},
): Promise<PendingExtractionRow[]> {
  const statusCondition: string = options.retryFailed
    ? `extract_status IN ('pending', 'failed')`
    : `extract_status = 'pending'`;

  const limitClause: string =
    options.limit != null ? `LIMIT ${String(options.limit)}` : '';

  const sql: string = `
    SELECT attachment_key, local_path, content_type
    FROM attachment
    WHERE download_status = 'downloaded'
      AND content_type = 'application/pdf'
      AND local_path IS NOT NULL
      AND ${statusCondition}
    ORDER BY attachment_key
    ${limitClause}`;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((r) => ({
    attachmentKey: Number(r.attachment_key),
    localPath: String(r.local_path),
    contentType: String(r.content_type),
  }));
}

export async function markExtracted(
  conn: DuckDBConnection,
  attachmentKey: number,
  fullText: string,
  textLength: number,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET full_text = $1,
          text_length = $2,
          extract_status = 'extracted'
      WHERE attachment_key = $3`,
    [fullText, textLength, attachmentKey] as DuckDBValue[],
  );
}

export async function markExtractionSkipped(
  conn: DuckDBConnection,
  attachmentKey: number,
  reason: 'skipped_no_text' | 'skipped_not_pdf',
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET extract_status = $1
      WHERE attachment_key = $2`,
    [reason, attachmentKey] as DuckDBValue[],
  );
}

export async function markExtractionFailed(
  conn: DuckDBConnection,
  attachmentKey: number,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET extract_status = 'failed'
      WHERE attachment_key = $1`,
    [attachmentKey] as DuckDBValue[],
  );
}
```

Export the new types and functions from `packages/server/src/attachments/index.ts`.

### Step 6: Write failing test for `markExtracted`

Add to repository.test.ts:

```typescript
describe('markExtracted', () => {
  beforeEach(async () => {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, local_path, extract_status)
       VALUES (200, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/200.pdf',
         'downloaded', '/tmp/200.pdf', 'pending')`
    );
  });

  it('updates full_text, text_length, and extract_status', async () => {
    await markExtracted(conn, 200, '# Heading\n\nSome text.', 20);
    const reader = await conn.runAndReadAll(
      `SELECT full_text, text_length, extract_status FROM attachment WHERE attachment_key = 200`
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.full_text)).toEqual('# Heading\n\nSome text.');
    expect(Number(row.text_length)).toEqual(20);
    expect(String(row.extract_status)).toEqual('extracted');
  });
});

describe('markExtractionSkipped', () => {
  beforeEach(async () => {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, local_path, extract_status)
       VALUES (201, 1, 'SAT-STA-20230614-00142', 'Scan', 'https://example.com/201.pdf',
         'downloaded', '/tmp/201.pdf', 'pending')`
    );
  });

  it('sets extract_status to skipped_no_text', async () => {
    await markExtractionSkipped(conn, 201, 'skipped_no_text');
    const reader = await conn.runAndReadAll(
      `SELECT extract_status FROM attachment WHERE attachment_key = 201`
    );
    expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual('skipped_no_text');
  });
});
```

### Step 7: Run tests to verify they pass

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/repository.test.ts
```

Expected: ALL PASS.

### Step 8: Commit

```bash
git add packages/server/package.json package.json pnpm-lock.yaml \
  packages/server/src/attachments/repository.ts \
  packages/server/src/attachments/repository.test.ts \
  packages/server/src/attachments/index.ts
git commit -m "feat(attachments): add extract_status column and extraction query functions"
```

---

## Task 2: PDF text extraction module

**Files:**
- Create: `packages/server/src/attachments/extract-text.ts` — core extraction logic
- Test: `packages/server/src/attachments/extract-text.test.ts`

### Step 1: Write failing tests for `extractTextFromPdf`

Create `packages/server/src/attachments/extract-text.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTextFromPdf } from './extract-text.ts';

// Use a real PDF from the attachments directory for integration testing.
// Pick a small, known-good text PDF and a known scanned PDF.
// These paths are relative to the project root (process.cwd()).
const TEXT_PDF_PATH: string = resolve(
  'data/attachments/ARC/ARC-MOD-20030610-00024/319622.pdf',
);
const SCANNED_PDF_PATH: string = resolve(
  'data/attachments/IHF/IHF-RWL-20150624-00003/1097976.pdf',
);

describe('extractTextFromPdf', () => {
  it('extracts markdown text from a text-based PDF', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF_PATH));
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('extracted');
    expect(result.textLength).toBeGreaterThan(100);
    expect(result.text).toContain('FEDERAL COMMUNICATIONS COMMISSION');
    expect(result.pageCount).toBeGreaterThan(0);
  });

  it('detects scanned PDFs and returns skipped status', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(SCANNED_PDF_PATH));
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('skipped_no_text');
    expect(result.textLength).toBeLessThan(50);
  });

  it('returns failed status for invalid PDF bytes', () => {
    const bytes: Uint8Array = new Uint8Array([0, 1, 2, 3]);
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('failed');
    expect(result.error).toBeDefined();
  });
});
```

> **Note for implementer:** Verify the two sample PDF paths exist on disk before running. If they don't exist (e.g. on CI), these tests should be marked with `it.skipIf(!existsSync(path))`.

### Step 2: Run tests to verify they fail

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/extract-text.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement `extractTextFromPdf`

Create `packages/server/src/attachments/extract-text.ts`:

```typescript
import { WasmPdfDocument } from 'pdf-oxide-wasm';

const MIN_TEXT_CHARS: number = 50;

export type ExtractionResult =
  | { status: 'extracted'; text: string; textLength: number; pageCount: number }
  | { status: 'skipped_no_text'; text: string; textLength: number; pageCount: number }
  | { status: 'failed'; text: null; textLength: 0; pageCount: 0; error: string };

/**
 * Extract markdown-formatted text from a PDF byte array.
 *
 * Uses pdf-oxide-wasm to extract per-page markdown with heading detection.
 * Images are excluded to avoid base64 noise from scanned documents.
 * PDFs with fewer than MIN_TEXT_CHARS non-whitespace characters are classified
 * as scanned/image-only and returned with status 'skipped_no_text'.
 */
export function extractTextFromPdf(bytes: Uint8Array): ExtractionResult {
  let doc: WasmPdfDocument | null = null;
  try {
    doc = new WasmPdfDocument(bytes);
    const pageCount: number = doc.pageCount();
    const pages: string[] = [];

    for (let i: number = 0; i < pageCount; i++) {
      const pageText: string = doc.toMarkdown(i, true, false);
      pages.push(pageText);
    }

    const text: string = pages.join('\n\n---\n\n');
    const textLength: number = text.replace(/\s/g, '').length;

    if (textLength < MIN_TEXT_CHARS) {
      return { status: 'skipped_no_text', text, textLength, pageCount };
    }

    return { status: 'extracted', text, textLength, pageCount };
  } catch (e: unknown) {
    const error: string = e instanceof Error ? e.message : String(e);
    return { status: 'failed', text: null, textLength: 0, pageCount: 0, error };
  } finally {
    doc?.free();
  }
}
```

### Step 4: Run tests to verify they pass

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/extract-text.test.ts
```

Expected: ALL PASS.

### Step 5: Commit

```bash
git add packages/server/src/attachments/extract-text.ts \
  packages/server/src/attachments/extract-text.test.ts
git commit -m "feat(attachments): add PDF text extraction module using pdf-oxide-wasm"
```

---

## Task 3: Extraction pipeline function

**Files:**
- Create: `packages/server/src/attachments/extract-pipeline.ts` — orchestrates batch extraction
- Test: `packages/server/src/attachments/extract-pipeline.test.ts`
- Modify: `packages/server/src/attachments/index.ts` — export new module

### Step 1: Write failing test for `runExtractionPipeline`

Create `packages/server/src/attachments/extract-pipeline.test.ts`:

```typescript
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentTable } from './repository.ts';
import { runExtractionPipeline } from './extract-pipeline.ts';
import type { ExtractionPipelineResult } from './extract-pipeline.ts';

// Minimal valid PDF (just enough to parse without error, with some text)
// In practice, copy a small real PDF from data/attachments for this fixture
// OR generate one with pdf-oxide-wasm's WasmPdf builder.

describe('runExtractionPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
    tmpDir = mkdtempSync(join(tmpdir(), 'extract-test-'));
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('extracts text from downloaded PDFs and updates the database', async () => {
    // Create a fake PDF file on disk (use a real small PDF for integration)
    // For unit test, we just verify the pipeline queries and updates correctly.
    // Seed a downloaded attachment pointing to a nonexistent file — expect 'failed'.
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, extract_status)
       VALUES (300, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/300.pdf',
         'downloaded', 'application/pdf', '${tmpDir}/nonexistent.pdf', 'pending')`
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
    });

    expect(result.failed).toEqual(1);
    expect(result.extracted + result.skippedNoText).toEqual(0);

    // Verify extract_status was updated
    const reader = await conn.runAndReadAll(
      `SELECT extract_status FROM attachment WHERE attachment_key = 300`
    );
    expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual('failed');
  });

  it('returns zero counts when nothing is pending', async () => {
    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
    });
    expect(result).toEqual({
      total: 0,
      extracted: 0,
      skippedNoText: 0,
      skippedNotPdf: 0,
      failed: 0,
      durationMs: expect.any(Number),
    });
  });
});
```

### Step 2: Run tests to verify they fail

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/extract-pipeline.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement `runExtractionPipeline`

Create `packages/server/src/attachments/extract-pipeline.ts`:

```typescript
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { extractTextFromPdf } from './extract-text.ts';
import { printProgress } from './progress.ts';
import {
  createAttachmentTable,
  getPendingExtractions,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
} from './repository.ts';
import type { PendingExtractionRow, ExtractionQueryOptions } from './repository.ts';

export type ExtractionPipelineOptions = {
  databaseUrl?: string;
  dbInstance?: DuckDBInstance;
  retryFailed?: boolean;
  limit?: number;
  verbose?: boolean;
  onProgress?: (msg: string) => void;
};

export type ExtractionPipelineResult = {
  total: number;
  extracted: number;
  skippedNoText: number;
  skippedNotPdf: number;
  failed: number;
  durationMs: number;
};

export async function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): Promise<ExtractionPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void = options.onProgress ?? console.log;

  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  trackInstance(db);
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await createAttachmentTable(conn);

  const queryOptions: ExtractionQueryOptions = {
    retryFailed: options.retryFailed,
    limit: options.limit,
  };
  const pending: PendingExtractionRow[] = await getPendingExtractions(conn, queryOptions);
  log(`${String(pending.length)} PDFs pending text extraction`);

  let extracted: number = 0;
  let skippedNoText: number = 0;
  let failed: number = 0;

  for (let i: number = 0; i < pending.length; i++) {
    const row: PendingExtractionRow = pending[i]!;

    try {
      const bytes: Uint8Array = new Uint8Array(readFileSync(row.localPath));
      const result = extractTextFromPdf(bytes);

      if (result.status === 'extracted') {
        await markExtracted(conn, row.attachmentKey, result.text, result.textLength);
        extracted++;
        if (options.verbose) {
          log(`  ${String(row.attachmentKey)}: extracted ${String(result.textLength)} chars (${String(result.pageCount)} pages)`);
        }
      } else if (result.status === 'skipped_no_text') {
        await markExtractionSkipped(conn, row.attachmentKey, 'skipped_no_text');
        skippedNoText++;
        if (options.verbose) {
          log(`  ${String(row.attachmentKey)}: skipped (no text)`);
        }
      } else {
        await markExtractionFailed(conn, row.attachmentKey);
        failed++;
        log(`  ${String(row.attachmentKey)}: FAILED — ${result.error}`);
      }
    } catch (e: unknown) {
      await markExtractionFailed(conn, row.attachmentKey);
      failed++;
      const msg: string = e instanceof Error ? e.message : String(e);
      log(`  ${String(row.attachmentKey)}: FAILED — ${msg}`);
    }

    printProgress(i + 1, pending.length, 'Extracting');
  }

  untrackConnection(conn);
  conn.closeSync();

  const durationMs: number = Date.now() - start;
  log(
    `Extraction complete: ${String(extracted)} extracted, ${String(skippedNoText)} skipped (no text), ${String(failed)} failed (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    total: pending.length,
    extracted,
    skippedNoText,
    skippedNotPdf: 0,
    failed,
    durationMs,
  };
}
```

### Step 4: Run tests to verify they pass

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/extract-pipeline.test.ts
```

Expected: ALL PASS.

### Step 5: Commit

```bash
git add packages/server/src/attachments/extract-pipeline.ts \
  packages/server/src/attachments/extract-pipeline.test.ts \
  packages/server/src/attachments/index.ts
git commit -m "feat(attachments): add extraction pipeline for batch PDF text extraction"
```

---

## Task 4: CLI command and Makefile target

**Files:**
- Create: `packages/server/src/cli/attachments/extract.ts` — CLI subcommand
- Modify: `packages/server/src/cli/attachments/index.ts` — register the command
- Modify: `Makefile` — add `attachments-extract` target

### Step 1: Create the CLI command

Create `packages/server/src/cli/attachments/extract.ts`:

```typescript
import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract text from downloaded PDF attachments',
  },
  args: {
    database: databaseArg,
    'retry-failed': {
      type: 'boolean',
      description: 'Re-attempt previously failed extractions',
      default: false,
    },
    limit: {
      type: 'string',
      description: 'Maximum number of PDFs to process',
    },
    verbose: {
      type: 'boolean',
      description: 'Log per-attachment details',
      default: false,
    },
  },
  async run({ args }) {
    const { runExtractionPipeline } =
      await import('../../attachments/extract-pipeline.ts');

    const result = await runExtractionPipeline({
      databaseUrl: resolveFromRoot(args.database),
      retryFailed: args['retry-failed'],
      limit: args.limit != null ? Number(args.limit) : undefined,
      verbose: args.verbose,
    });

    console.log('\nSummary:');
    console.log(`  Total processed:    ${String(result.total)}`);
    console.log(`  Extracted:          ${String(result.extracted)}`);
    console.log(`  Skipped (no text):  ${String(result.skippedNoText)}`);
    console.log(`  Failed:             ${String(result.failed)}`);
    console.log(`  Duration:           ${String(Math.round(result.durationMs / 1000))}s`);
  },
});
```

### Step 2: Register the command

In `packages/server/src/cli/attachments/index.ts`, add:

```typescript
import { extractCommand } from './extract.ts';
```

And add `extract: extractCommand` to the `subCommands` object.

### Step 3: Add Makefile target

Add after the `attachments-reset` target:

```makefile
attachments-extract: ## Extract text from downloaded PDF attachments
	$(CLI) attachments extract $(ARGS)
```

### Step 4: Smoke test

```bash
# Extract text from a small sample to verify end-to-end
make attachments-extract ARGS="--limit 10 --verbose"
```

Expected: Processes 10 PDFs, shows per-attachment results, summary at the end.

### Step 5: Commit

```bash
git add packages/server/src/cli/attachments/extract.ts \
  packages/server/src/cli/attachments/index.ts \
  Makefile
git commit -m "feat(attachments): add 'attachments extract' CLI command and make target"
```

---

## Task 5: Integration test with real PDFs

**Files:**
- Create: `packages/server/src/attachments/extract-integration.test.ts`

This test uses real PDFs from `data/attachments/` to validate the full extraction → DB round-trip.

### Step 1: Write the integration test

```typescript
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentTable, getPendingExtractions, markExtracted } from './repository.ts';
import { extractTextFromPdf } from './extract-text.ts';
import type { ExtractionResult } from './extract-text.ts';

// Known text-based PDF (from our sampling)
const TEXT_PDF: string = resolve('data/attachments/ITC/ITC-214-INTR2017-00369/1182093.pdf');
// Known scanned PDF
const SCANNED_PDF: string = resolve('data/attachments/ROA/ROA-NEW-20030217-00001/722390.pdf');

const canRunIntegration: boolean = existsSync(TEXT_PDF) && existsSync(SCANNED_PDF);

describe.skipIf(!canRunIntegration)('PDF extraction integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('extracts structured markdown from a text-based FCC filing PDF', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);

    expect(result.status).toEqual('extracted');
    if (result.status !== 'extracted') return;

    // Should contain FCC form content
    expect(result.text).toContain('streamlined processing');
    expect(result.textLength).toBeGreaterThan(500);
    expect(result.pageCount).toEqual(1);
  });

  it('correctly identifies a scanned PDF as having no extractable text', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(SCANNED_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);

    expect(result.status).toEqual('skipped_no_text');
    if (result.status === 'failed') return;
    expect(result.textLength).toBeLessThan(50);
  });

  it('round-trips extraction through the database', async () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);
    expect(result.status).toEqual('extracted');
    if (result.status !== 'extracted') return;

    // Insert and mark extracted
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, extract_status)
       VALUES (500, 1, 'ITC-214-INTR2017-00369', 'Doc', 'https://example.com/500.pdf',
         'downloaded', 'application/pdf', '${TEXT_PDF}', 'pending')`
    );

    await markExtracted(conn, 500, result.text, result.textLength);

    // Verify it's no longer pending
    const pending = await getPendingExtractions(conn);
    expect(pending).toHaveLength(0);

    // Verify text is stored
    const reader = await conn.runAndReadAll(
      `SELECT full_text, text_length, extract_status FROM attachment WHERE attachment_key = 500`
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.extract_status)).toEqual('extracted');
    expect(Number(row.text_length)).toEqual(result.textLength);
    expect(String(row.full_text)).toContain('streamlined processing');
  });
});
```

### Step 2: Run tests

```bash
pnpm --filter @daily-orbit/server vitest run src/attachments/extract-integration.test.ts
```

Expected: ALL PASS (skipped if PDFs not on disk).

### Step 3: Commit

```bash
git add packages/server/src/attachments/extract-integration.test.ts
git commit -m "test(attachments): add integration tests for PDF text extraction"
```

---

## Task 6: Clean up test scripts

**Files:**
- Delete: `scripts/check-pdf-text.sh`
- Delete: `scripts/test-pdf-oxide.ts`
- Delete: `scripts/test-pdf-oxide-stats.ts`

### Step 1: Remove temporary scripts

```bash
rm scripts/check-pdf-text.sh scripts/test-pdf-oxide.ts scripts/test-pdf-oxide-stats.ts
```

### Step 2: Run full test suite

```bash
pnpm test
```

Expected: ALL PASS.

### Step 3: Commit

```bash
git add -u scripts/
git commit -m "chore: remove temporary PDF extraction test scripts"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB schema: `extract_status` column + query functions | repository.ts, repository.test.ts |
| 2 | Core extraction: `extractTextFromPdf()` | extract-text.ts, extract-text.test.ts |
| 3 | Pipeline orchestration: `runExtractionPipeline()` | extract-pipeline.ts, extract-pipeline.test.ts |
| 4 | CLI command + Makefile | cli/attachments/extract.ts, index.ts, Makefile |
| 5 | Integration test with real PDFs | extract-integration.test.ts |
| 6 | Clean up temp scripts | scripts/ |

**Total: 6 tasks, ~6 commits, ~4 new files + 4 modified files.**
