# Full-Text & Semantic Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add BM25 full-text search and (later) vector semantic search to the existing filtered browse UI, so users can search filing/attachment/pleading content by relevance while keeping all existing metadata filters.

**Architecture:** The existing search page is a filtered browse (ILIKE + IN-list + date range) with three tabs (Filings, Satellites, Earth Stations). We add a content search box above the tabs that activates BM25 ranking via DuckDB's `fts` extension. When the query box is empty, behavior is unchanged. When filled, results are ranked by relevance score and a snippet column appears. Existing filters become WHERE clauses applied to the ranked result set. The FTS index is static and rebuilt as a post-ingest pipeline step. Vector search (Phase 2) layers on top via Reciprocal Rank Fusion without changing the API contract.

**Tech Stack:** DuckDB `fts` extension (BM25), DuckDB `vss` extension (HNSW, Phase 2), AWS Bedrock Titan Embed V2 (Phase 2), existing React/TanStack Table/Tailwind frontend, DOMPurify for safe HTML rendering.

---

## Phase 1: BM25 Full-Text Search

### Task 1: FTS Index Management Module

Create a module that builds and rebuilds DuckDB FTS indexes on attachment full_text, filing description, and pleading content.

**Files:**
- Create: `packages/server/src/search/fts-index.ts`
- Test: `packages/server/src/search/fts-index.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/search/fts-index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

describe('FTS index management', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Minimal schema for testing
    await conn.run(`
      CREATE TABLE filing (
        file_number VARCHAR PRIMARY KEY,
        description VARCHAR,
        brief_description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
        full_text VARCHAR,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE pleading (
        pleading_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        filer_name VARCHAR,
        exhibit_attachment_html VARCHAR
      )
    `);

    // Insert test data
    await conn.run(`INSERT INTO filing VALUES ('SAT-LOA-20240101-00001', 'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite')`);
    await conn.run(`INSERT INTO filing VALUES ('SES-LIC-20240201-00002', 'Earth station license application', 'Earth station')`);
    await conn.run(`INSERT INTO attachment VALUES (1, 'SAT-LOA-20240101-00001', 'Technical narrative describing Ka-band frequency coordination with adjacent satellites', NULL)`);
    await conn.run(`INSERT INTO attachment VALUES (2, 'SES-LIC-20240201-00002', 'Site survey for proposed earth station location in Virginia', NULL)`);
    await conn.run(`INSERT INTO pleading VALUES (1, 100, 'SpaceX', 'Comments opposing the Ka-band frequency allocation due to interference concerns')`);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('should create FTS indexes on all three tables', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await rebuildAllFtsIndexes(conn);

    // Verify indexes exist by querying each one
    const filingResult = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'satellite') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(filingResult.getRowObjectsJS().length).toEqual(1);

    const attachmentResult = await conn.runAndReadAll(`
      SELECT attachment_key, fts_main_attachment.match_bm25(attachment_key, 'frequency') AS score
      FROM attachment WHERE score IS NOT NULL
    `);
    expect(attachmentResult.getRowObjectsJS().length).toEqual(1);

    const pleadingResult = await conn.runAndReadAll(`
      SELECT pleading_key, fts_main_pleading.match_bm25(pleading_key, 'interference') AS score
      FROM pleading WHERE score IS NOT NULL
    `);
    expect(pleadingResult.getRowObjectsJS().length).toEqual(1);
  });

  it('should rebuild indexes idempotently (overwrite)', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await rebuildAllFtsIndexes(conn);
    // Second call should not throw
    await rebuildAllFtsIndexes(conn);

    const result = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'satellite') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(result.getRowObjectsJS().length).toEqual(1);
  });

  it('should handle empty tables without error', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await conn.run('DELETE FROM filing');
    await conn.run('DELETE FROM attachment');
    await conn.run('DELETE FROM pleading');
    await rebuildAllFtsIndexes(conn);
    // Should not throw; querying empty index returns no results
    const result = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'anything') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(result.getRowObjectsJS().length).toEqual(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/fts-index.test.ts`
Expected: FAIL — module `./fts-index.ts` not found.

**Step 3: Write minimal implementation**

```typescript
// packages/server/src/search/fts-index.ts
import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Rebuild all FTS indexes. Call after data ingestion completes.
 * Each index is created with overwrite=1 so it replaces any existing index.
 */
export async function rebuildAllFtsIndexes(conn: DuckDBConnection): Promise<void> {
  await conn.run(`INSTALL fts; LOAD fts;`);

  // Filing: index description and brief_description
  await conn.run(`
    PRAGMA create_fts_index(
      'filing', 'file_number',
      'description', 'brief_description',
      stemmer = 'english',
      stopwords = 'english',
      lower = 1,
      overwrite = 1
    )
  `);

  // Attachment: index full_text and summary
  await conn.run(`
    PRAGMA create_fts_index(
      'attachment', 'attachment_key',
      'full_text', 'summary',
      stemmer = 'english',
      stopwords = 'english',
      lower = 1,
      overwrite = 1
    )
  `);

  // Pleading: index filer_name and exhibit_attachment_html
  await conn.run(`
    PRAGMA create_fts_index(
      'pleading', 'pleading_key',
      'filer_name', 'exhibit_attachment_html',
      stemmer = 'english',
      stopwords = 'english',
      lower = 1,
      overwrite = 1
    )
  `);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/fts-index.test.ts`
Expected: PASS — all 3 tests green.

**Step 5: Commit**

```bash
git add packages/server/src/search/fts-index.ts packages/server/src/search/fts-index.test.ts
git commit -m "feat(search): add FTS index management module with BM25 indexing"
```

---

### Task 2: CLI Command for FTS Index Rebuild

Add a `daily-orbit search rebuild-index` CLI command.

**Files:**
- Create: `packages/server/src/cli/search/index.ts`
- Modify: `packages/server/src/cli/index.ts` (register the new subcommand)

**Step 1: Implement the CLI command**

```typescript
// packages/server/src/cli/search/index.ts
import { Command } from 'commander';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../../lib/db.ts';
import { rebuildAllFtsIndexes } from '../../search/fts-index.ts';

export function registerSearchCommands(program: Command): void {
  const search: Command = program.command('search').description('Search index management');

  search
    .command('rebuild-index')
    .description('Rebuild all full-text search indexes (run after data ingestion)')
    .action(async () => {
      const db = await getDb();
      const conn: DuckDBConnection = await DuckDBConnection.create(db);
      try {
        console.log('Rebuilding FTS indexes...');
        const start: number = Date.now();
        await rebuildAllFtsIndexes(conn);
        const elapsed: number = Date.now() - start;
        console.log(`FTS indexes rebuilt in ${(elapsed / 1000).toFixed(1)}s`);
      } finally {
        conn.closeSync();
      }
    });
}
```

**Step 2: Register in main CLI**

In `packages/server/src/cli/index.ts`, add:
```typescript
import { registerSearchCommands } from './search/index.ts';
// ... in the setup function:
registerSearchCommands(program);
```

**Step 3: Add Makefile target**

Add to `Makefile`:
```makefile
search-rebuild-index:
	./daily-orbit search rebuild-index
```

**Step 4: Test manually**

Run: `cd /Users/benton/code/daily-orbit && ./daily-orbit search rebuild-index`
Expected: "Rebuilding FTS indexes..." then "FTS indexes rebuilt in X.Xs"

**Step 5: Commit**

```bash
git add packages/server/src/cli/search/index.ts packages/server/src/cli/index.ts Makefile
git commit -m "feat(cli): add search rebuild-index command for FTS index management"
```

---

### Task 3: Snippet Extraction Utility

DuckDB's FTS does not generate snippets. We need a utility that, given a document text and search terms, returns a snippet with the matched terms highlighted.

**Files:**
- Create: `packages/server/src/search/snippet.ts`
- Test: `packages/server/src/search/snippet.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/search/snippet.test.ts
import { describe, it, expect } from 'vitest';
import { extractSnippet } from './snippet.ts';

describe('extractSnippet', () => {
  const longText: string =
    'The Federal Communications Commission today released a public notice regarding satellite frequency coordination. ' +
    'The application seeks authority to launch and operate a geostationary satellite in the Ka-band. ' +
    'Adjacent satellite operators have filed comments expressing concerns about potential interference. ' +
    'The technical analysis demonstrates compliance with applicable power flux density limits.';

  it('should return a snippet centered on the first match', () => {
    const result: { snippet: string; matchCount: number } = extractSnippet(longText, 'Ka-band', 120);
    expect(result.snippet).toContain('<mark>Ka-band</mark>');
    expect(result.matchCount).toEqual(1);
  });

  it('should highlight multiple occurrences of the same term', () => {
    const text: string = 'satellite operators and satellite systems and satellite networks';
    const result = extractSnippet(text, 'satellite', 200);
    expect(result.snippet.match(/<mark>/g)?.length).toEqual(3);
    expect(result.matchCount).toEqual(3);
  });

  it('should handle multi-word queries by highlighting each term', () => {
    const result = extractSnippet(longText, 'satellite interference', 200);
    expect(result.snippet).toContain('<mark>satellite</mark>');
    expect(result.snippet).toContain('<mark>interference</mark>');
  });

  it('should be case-insensitive', () => {
    const result = extractSnippet(longText, 'SATELLITE', 200);
    expect(result.snippet).toContain('<mark>');
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('should return truncated text with ellipsis when no match is found', () => {
    const result = extractSnippet(longText, 'xyznonexistent', 50);
    expect(result.snippet.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(result.matchCount).toEqual(0);
  });

  it('should return empty snippet for null or empty input', () => {
    expect(extractSnippet(null, 'test', 100).snippet).toEqual('');
    expect(extractSnippet('', 'test', 100).snippet).toEqual('');
  });

  it('should escape HTML in the source text to prevent XSS', () => {
    const xssText: string = 'Some <script>alert("xss")</script> satellite text';
    const result = extractSnippet(xssText, 'satellite', 200);
    expect(result.snippet).not.toContain('<script>');
    expect(result.snippet).toContain('&lt;script&gt;');
    expect(result.snippet).toContain('<mark>satellite</mark>');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/snippet.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/server/src/search/snippet.ts

/** Escape HTML special characters to prevent XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extract a snippet from `text` centered around the first occurrence of any
 * search term, with all occurrences wrapped in <mark> tags.
 *
 * Security: Source text is HTML-escaped before highlight markup is inserted,
 * so only our <mark> tags appear in the output. The frontend should still
 * render via DOMPurify as defense-in-depth (see Task 6 notes).
 *
 * @param text - Source text (may be null)
 * @param query - Space-separated search terms
 * @param maxLength - Maximum character length of the returned snippet (before markup)
 * @returns snippet with <mark> highlights and a count of matches
 */
export function extractSnippet(
  text: string | null | undefined,
  query: string,
  maxLength: number = 150,
): { snippet: string; matchCount: number } {
  if (text == null || text === '') {
    return { snippet: '', matchCount: 0 };
  }

  const terms: string[] = query
    .split(/\s+/)
    .filter((t: string) => t.length > 0)
    .map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) {
    return { snippet: escapeHtml(text.slice(0, maxLength)) + (text.length > maxLength ? '...' : ''), matchCount: 0 };
  }

  const pattern: RegExp = new RegExp(`(${terms.join('|')})`, 'gi');

  // Find the first match to center the snippet
  const firstMatch: RegExpMatchArray | null = text.match(pattern);
  let start: number = 0;
  if (firstMatch?.index != null) {
    start = Math.max(0, firstMatch.index - Math.floor(maxLength / 3));
  }
  const end: number = Math.min(text.length, start + maxLength);

  let slice: string = text.slice(start, end);
  const prefix: string = start > 0 ? '...' : '';
  const suffix: string = end < text.length ? '...' : '';

  // Escape HTML first, then apply highlights
  slice = escapeHtml(slice);
  let matchCount: number = 0;
  const escapedTerms: string[] = terms.map((t: string) => escapeHtml(t.replace(/\\(.)/g, '$1')));
  const highlightPattern: RegExp = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
  slice = slice.replace(highlightPattern, (_match: string) => {
    matchCount++;
    return `<mark>${_match}</mark>`;
  });

  return { snippet: prefix + slice + suffix, matchCount };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/snippet.test.ts`
Expected: PASS — all 7 tests green.

**Step 5: Commit**

```bash
git add packages/server/src/search/snippet.ts packages/server/src/search/snippet.test.ts
git commit -m "feat(search): add snippet extraction with HTML-safe highlighting"
```

---

### Task 4: Content Search Repository Function

Add a `searchFilingContent` function that joins filing + attachment + pleading FTS results, applies existing metadata filters, and returns ranked results with snippets.

**Files:**
- Create: `packages/server/src/search/content-search.ts`
- Modify: `packages/server/src/search/types.ts` (add new types)
- Test: `packages/server/src/search/content-search.test.ts`

**Step 1: Add types**

Add to `packages/server/src/search/types.ts`:

```typescript
/** Search mode for content search */
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

/** Content search query parameters (on top of existing filters) */
export type ContentSearchQuery = {
  /** Free-text search query */
  q: string;
  /** Search mode */
  mode?: SearchMode;
};

/** A single content search hit */
export type ContentSearchHit = {
  /** The filing's file_number */
  file_number: string;
  /** Which source matched: filing metadata, attachment text, or pleading */
  source: 'filing' | 'attachment' | 'pleading';
  /** Source identifier (attachment_key or pleading_key, null for filing) */
  source_key: string | null;
  /** BM25 relevance score */
  score: number;
  /** Snippet with <mark> highlights */
  snippet: string;
  /** Filing metadata for display */
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
};
```

**Step 2: Write the failing test**

```typescript
// packages/server/src/search/content-search.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { rebuildAllFtsIndexes } from './fts-index.ts';

describe('searchFilingContent', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create tables with columns needed by the search query
    await conn.run(`
      CREATE TABLE filing (
        file_number VARCHAR PRIMARY KEY,
        filing_key INTEGER,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        date_filed DATE,
        company_id UUID,
        description VARCHAR,
        brief_description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
        filing_key INTEGER,
        full_text VARCHAR,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE pleading (
        pleading_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        filer_name VARCHAR,
        exhibit_attachment_html VARCHAR
      )
    `);
    await conn.run(`CREATE TABLE company (id UUID PRIMARY KEY, name VARCHAR, parent_company_id UUID)`);

    // Test data: two filings, one with attachment text about Ka-band
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SES-LIC-20240201-00002', 2, 'E001', 'Hughes Net', 'SES', 'LIC', 'P', '2024-02-01', NULL,
      'Earth station license application', 'Earth station'
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      1, 'SAT-LOA-20240101-00001', 1,
      'Technical narrative describing Ka-band frequency coordination with adjacent satellite operators and detailed interference analysis',
      NULL
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      2, 'SES-LIC-20240201-00002', 2,
      'Site survey report for the proposed Virginia earth station location',
      NULL
    )`);
    await conn.run(`INSERT INTO pleading VALUES (
      1, 1, 'Viasat Inc',
      'Comments opposing Ka-band allocation due to interference concerns with existing satellite networks'
    )`);

    await rebuildAllFtsIndexes(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('should return ranked results matching a content query', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(conn, { q: 'Ka-band interference' }, {}, { page: 1, pageSize: 25 });

    expect(result.data.length).toBeGreaterThan(0);
    // The Ka-band filing should appear (matched in description, attachment, and pleading)
    const fileNumbers: string[] = result.data.map((h) => h.file_number);
    expect(fileNumbers).toContain('SAT-LOA-20240101-00001');
    // Results should have snippets
    expect(result.data[0].snippet).toContain('<mark>');
    // Results should be sorted by score descending
    for (let i: number = 1; i < result.data.length; i++) {
      expect(result.data[i - 1].score).toBeGreaterThanOrEqual(result.data[i].score);
    }
  });

  it('should apply metadata filters alongside content search', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    // Search for "station" but filter to SAT subsystem only — should exclude SES filing
    const result = await searchFilingContent(
      conn,
      { q: 'station' },
      { subsystem_code: ['SAT'] },
      { page: 1, pageSize: 25 },
    );

    const fileNumbers: string[] = result.data.map((h) => h.file_number);
    expect(fileNumbers).not.toContain('SES-LIC-20240201-00002');
  });

  it('should return empty results for unmatched query', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(conn, { q: 'xyznonexistent' }, {}, { page: 1, pageSize: 25 });
    expect(result.data).toEqual([]);
    expect(result.totalRows).toEqual(0);
  });

  it('should paginate results', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(conn, { q: 'satellite' }, {}, { page: 1, pageSize: 1 });
    expect(result.data.length).toEqual(1);
    expect(result.pageSize).toEqual(1);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/content-search.test.ts`
Expected: FAIL — module not found.

**Step 4: Write implementation**

```typescript
// packages/server/src/search/content-search.ts
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  buildPaginatedResponse,
  normalizePaginatedRequest,
  type PaginatedRequest,
  type PaginatedResponse,
} from '../lib/pagination.ts';
import { extractSnippet } from './snippet.ts';
import type { ContentSearchHit, ContentSearchQuery, FilingSearchFilters } from './types.ts';

/**
 * Search across filing descriptions, attachment full_text, and pleading content
 * using BM25 full-text search, with optional metadata filters.
 *
 * Results are deduplicated by file_number (best score per filing wins) and
 * returned in descending relevance order.
 */
export async function searchFilingContent(
  conn: DuckDBConnection,
  query: ContentSearchQuery,
  filters: FilingSearchFilters,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<ContentSearchHit>> {
  const { page, pageSize } = normalizePaginatedRequest(pagination);
  const offset: number = (page - 1) * pageSize;
  const q: string = query.q.trim();

  if (q === '') {
    return buildPaginatedResponse([], 0, pagination);
  }

  // Build filter conditions and params
  const conditions: string[] = [];
  const params: DuckDBValue[] = [q, q, q]; // $1, $2, $3 for the three match_bm25 calls
  let paramIndex: number = 4;

  if (filters.subsystem_code != null && filters.subsystem_code.length > 0) {
    const placeholders: string = filters.subsystem_code.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`f.subsystem_code IN (${placeholders})`);
    params.push(...(filters.subsystem_code as DuckDBValue[]));
  }

  if (filters.app_type_code != null && filters.app_type_code.length > 0) {
    const placeholders: string = filters.app_type_code.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`f.app_type_code IN (${placeholders})`);
    params.push(...(filters.app_type_code as DuckDBValue[]));
  }

  if (filters.status_code != null && filters.status_code.length > 0) {
    const placeholders: string = filters.status_code.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`f.status_code IN (${placeholders})`);
    params.push(...(filters.status_code as DuckDBValue[]));
  }

  if (filters.date_filed_from != null && filters.date_filed_from.trim() !== '') {
    conditions.push(`f.date_filed >= $${paramIndex}`);
    params.push(filters.date_filed_from.trim());
    paramIndex++;
  }

  if (filters.date_filed_to != null && filters.date_filed_to.trim() !== '') {
    conditions.push(`f.date_filed <= $${paramIndex}`);
    params.push(filters.date_filed_to.trim());
    paramIndex++;
  }

  if (filters.company != null && filters.company.trim() !== '') {
    conditions.push(`f.company_id IN (
      SELECT c.id FROM company c WHERE c.name ILIKE $${paramIndex}
      UNION
      SELECT c.id FROM company c WHERE c.parent_company_id IN (SELECT c2.id FROM company c2 WHERE c2.name ILIKE $${paramIndex})
    )`);
    params.push(`%${filters.company.trim()}%`);
    paramIndex++;
  }

  if (filters.callsign != null && filters.callsign.trim() !== '') {
    conditions.push(`f.callsign ILIKE $${paramIndex}`);
    params.push(`%${filters.callsign.trim()}%`);
    paramIndex++;
  }

  if (filters.applicant != null && filters.applicant.trim() !== '') {
    conditions.push(`f.address_attention ILIKE $${paramIndex}`);
    params.push(`%${filters.applicant.trim()}%`);
    paramIndex++;
  }

  const filterClause: string = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

  // Union BM25 results from all three tables, deduplicate by file_number keeping best score.
  // Each CTE searches one table and joins back to filing for metadata + filtering.
  const sql: string = `
    WITH filing_hits AS (
      SELECT f.file_number, 'filing' AS source, NULL AS source_key,
        fts_main_filing.match_bm25(f.file_number, $1, fields := 'description,brief_description') AS score,
        f.description AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM filing f
      WHERE fts_main_filing.match_bm25(f.file_number, $1, fields := 'description,brief_description') IS NOT NULL
        ${filterClause}
    ),
    attachment_hits AS (
      SELECT f.file_number, 'attachment' AS source, CAST(a.attachment_key AS VARCHAR) AS source_key,
        fts_main_attachment.match_bm25(a.attachment_key, $2, fields := 'full_text,summary') AS score,
        a.full_text AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM attachment a
      JOIN filing f ON a.file_number = f.file_number
      WHERE fts_main_attachment.match_bm25(a.attachment_key, $2, fields := 'full_text,summary') IS NOT NULL
        ${filterClause}
    ),
    pleading_hits AS (
      SELECT f.file_number, 'pleading' AS source, CAST(p.pleading_key AS VARCHAR) AS source_key,
        fts_main_pleading.match_bm25(p.pleading_key, $3, fields := 'filer_name,exhibit_attachment_html') AS score,
        p.exhibit_attachment_html AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM pleading p
      JOIN filing f ON p.filing_key = f.filing_key
      WHERE fts_main_pleading.match_bm25(p.pleading_key, $3, fields := 'filer_name,exhibit_attachment_html') IS NOT NULL
        ${filterClause}
    ),
    all_hits AS (
      SELECT * FROM filing_hits
      UNION ALL
      SELECT * FROM attachment_hits
      UNION ALL
      SELECT * FROM pleading_hits
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY file_number ORDER BY score DESC) AS rn
      FROM all_hits
    )
    SELECT r.file_number, r.source, r.source_key, r.score, r.matched_text,
      r.callsign, r.address_attention, r.subsystem_code, r.app_type_code, r.status_code, r.date_filed,
      (SELECT co.name FROM company co WHERE co.id = r.company_id) AS company_name
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r.score DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const countSql: string = `
    WITH filing_hits AS (
      SELECT f.file_number
      FROM filing f
      WHERE fts_main_filing.match_bm25(f.file_number, $1, fields := 'description,brief_description') IS NOT NULL
        ${filterClause}
    ),
    attachment_hits AS (
      SELECT f.file_number
      FROM attachment a JOIN filing f ON a.file_number = f.file_number
      WHERE fts_main_attachment.match_bm25(a.attachment_key, $2, fields := 'full_text,summary') IS NOT NULL
        ${filterClause}
    ),
    pleading_hits AS (
      SELECT f.file_number
      FROM pleading p JOIN filing f ON p.filing_key = f.filing_key
      WHERE fts_main_pleading.match_bm25(p.pleading_key, $3, fields := 'filer_name,exhibit_attachment_html') IS NOT NULL
        ${filterClause}
    )
    SELECT COUNT(DISTINCT file_number) AS total FROM (
      SELECT file_number FROM filing_hits
      UNION ALL SELECT file_number FROM attachment_hits
      UNION ALL SELECT file_number FROM pleading_hits
    )
  `;

  const [dataReader, countReader] = await Promise.all([
    conn.runAndReadAll(sql, params),
    conn.runAndReadAll(countSql, params),
  ]);

  const totalRows: number = Number(countReader.getRowObjectsJS()[0]?.total ?? 0);

  const data: ContentSearchHit[] = dataReader.getRowObjectsJS().map((row: Record<string, unknown>) => {
    const matchedText: string | null = row.matched_text != null ? String(row.matched_text) : null;
    const { snippet, matchCount: _ } = extractSnippet(matchedText, q, 200);

    return {
      file_number: String(row.file_number ?? ''),
      source: String(row.source) as 'filing' | 'attachment' | 'pleading',
      source_key: row.source_key != null ? String(row.source_key) : null,
      score: Number(row.score ?? 0),
      snippet,
      callsign: row.callsign != null ? String(row.callsign) : null,
      address_attention: row.address_attention != null ? String(row.address_attention) : null,
      subsystem_code: String(row.subsystem_code ?? ''),
      app_type_code: String(row.app_type_code ?? ''),
      status_code: row.status_code != null ? String(row.status_code) : null,
      date_filed: row.date_filed != null ? String(row.date_filed) : null,
      company_name: row.company_name != null ? String(row.company_name) : null,
    };
  });

  return buildPaginatedResponse(data, totalRows, pagination);
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/content-search.test.ts`
Expected: PASS — all 4 tests green.

**Step 6: Commit**

```bash
git add packages/server/src/search/content-search.ts packages/server/src/search/content-search.test.ts packages/server/src/search/types.ts
git commit -m "feat(search): add BM25 content search across filings, attachments, and pleadings"
```

---

### Task 5: Content Search API Route

Wire the content search function into the Hono API.

**Files:**
- Modify: `packages/server/src/search/routes.ts`

**Step 1: Add the route**

Add to `packages/server/src/search/routes.ts`:

```typescript
import { searchFilingContent } from './content-search.ts';
import type { FilingSearchFilters } from './types.ts';

// GET /api/search/content
searchRoutes.get('/content', async (c) => {
  const q = c.req.query();
  const contentQuery = { q: q.q ?? '', mode: q.mode as 'keyword' | 'semantic' | 'hybrid' | undefined };

  // Reuse existing filter parsing
  const filters: FilingSearchFilters = {};
  if (q.callsign != null) filters.callsign = q.callsign;
  if (q.applicant != null) filters.applicant = q.applicant;
  if (q.company != null) filters.company = q.company;
  const subsystems = parseList(q.subsystem_code);
  if (subsystems != null) filters.subsystem_code = subsystems;
  const appTypes = parseList(q.app_type_code);
  if (appTypes != null) filters.app_type_code = appTypes;
  const statuses = parseList(q.status_code);
  if (statuses != null) filters.status_code = statuses;
  if (q.date_filed_from != null) filters.date_filed_from = q.date_filed_from;
  if (q.date_filed_to != null) filters.date_filed_to = q.date_filed_to;

  const pagination: PaginatedRequest = parsePagination(q);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const result = await searchFilingContent(conn, contentQuery, filters, pagination);
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});
```

**Step 2: Test manually**

Run the API server and hit:
```
curl 'http://localhost:3000/api/search/content?q=Ka-band+satellite&pageSize=5'
```
Expected: JSON response with ranked hits containing snippets.

**Step 3: Commit**

```bash
git add packages/server/src/search/routes.ts
git commit -m "feat(api): add GET /api/search/content endpoint for full-text search"
```

---

### Task 6: Frontend — Content Search Box

Add the content search input above the tab bar in SearchPage.

**Security note:** Snippets contain server-generated HTML (`<mark>` tags). The server's `extractSnippet` function HTML-escapes source text before inserting markup, so only `<mark>` tags are present. As defense-in-depth, install DOMPurify and sanitize before rendering:

```bash
pnpm add dompurify && pnpm add -D @types/dompurify
```

Then in the snippet cell renderer, sanitize:
```typescript
import DOMPurify from 'dompurify';
// In the cell:
<span className="line-clamp-2 text-sm"
  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getValue() as string) }} />
```

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`
- Install: `dompurify` + `@types/dompurify`

**Step 1: Install DOMPurify**

Run: `cd /Users/benton/code/daily-orbit && pnpm add dompurify && pnpm add -D @types/dompurify`

**Step 2: Add content query state and types**

Add to the SearchPage component:

```typescript
// New state for content search
const [contentQuery, setContentQuery] = useState<string>('');
const [searchMode, setSearchMode] = useState<'keyword' | 'semantic' | 'hybrid'>('keyword');

// Whether we're in "content search" mode (query box has text)
const isContentSearch: boolean = contentQuery.trim() !== '';
```

**Step 3: Add the search box UI**

Insert above the tab bar in the JSX:

```tsx
{/* Content search bar */}
<div className="flex items-center gap-3">
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
    <Input
      className="pl-10"
      onChange={(e) => setContentQuery(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
      placeholder="Search filing content, attachments, and comments..."
      value={contentQuery}
    />
  </div>
  <select
    className="h-9 rounded-md border border-neutral-200 bg-transparent px-2 text-sm dark:border-neutral-700"
    onChange={(e) => setSearchMode(e.target.value as 'keyword' | 'semantic' | 'hybrid')}
    value={searchMode}
  >
    <option value="keyword">Keyword</option>
    <option value="semantic" disabled>Semantic (coming soon)</option>
    <option value="hybrid" disabled>Hybrid (coming soon)</option>
  </select>
</div>
```

**Step 4: Add content search result type and columns**

```typescript
import DOMPurify from 'dompurify';

type ContentSearchResult = {
  file_number: string;
  source: 'filing' | 'attachment' | 'pleading';
  source_key: string | null;
  score: number;
  snippet: string;
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
};

const contentColumns: Array<ColumnDef<ContentSearchResult, unknown>> = [
  {
    accessorKey: 'file_number',
    header: 'File Number',
    size: 220,
    cell: ({ getValue }) => <span className="font-mono text-sm">{getValue() as string}</span>,
  },
  {
    accessorKey: 'source',
    header: 'Source',
    size: 90,
    cell: ({ getValue }) => {
      const source: string = getValue() as string;
      const label: string = source === 'filing' ? 'Filing' : source === 'attachment' ? 'Attachment' : 'Comment';
      return <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-700">{label}</span>;
    },
  },
  { accessorKey: 'address_attention', header: 'Applicant', size: 160 },
  { accessorKey: 'subsystem_code', header: 'Subsystem', size: 80 },
  {
    accessorKey: 'snippet',
    header: 'Match',
    size: 350,
    cell: ({ getValue }) => (
      <span
        className="line-clamp-2 text-sm"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getValue() as string) }}
      />
    ),
  },
  {
    accessorKey: 'date_filed',
    header: 'Date Filed',
    size: 100,
    cell: ({ getValue }) => {
      const v: string | null = getValue() as string | null;
      return v != null ? new Date(v).toLocaleDateString() : '';
    },
  },
  {
    accessorKey: 'score',
    header: 'Relevance',
    size: 80,
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
  },
];
```

**Step 5: Add content search fetch function**

```typescript
const fetchContent = useCallback(
  (params: DataTableFetchParams): Promise<PaginatedResponse<ContentSearchResult>> => {
    const parts: Array<string> = [
      `q=${encodeURIComponent(contentQuery.trim())}`,
      `mode=${searchMode}`,
      `page=${params.page}`,
      `pageSize=${params.pageSize}`,
    ];
    if (params.sort != null) parts.push(`sort=${params.sort}`);
    if (params.order != null) parts.push(`order=${params.order}`);
    // Pass through active filing filters
    if (filingFilters.subsystem_code.length > 0)
      parts.push(`subsystem_code=${filingFilters.subsystem_code.join(',')}`);
    if (filingFilters.app_type_code.length > 0)
      parts.push(`app_type_code=${filingFilters.app_type_code.join(',')}`);
    if (filingFilters.status_code.length > 0)
      parts.push(`status_code=${filingFilters.status_code.join(',')}`);
    if (filingFilters.date_filed_from !== '')
      parts.push(`date_filed_from=${filingFilters.date_filed_from}`);
    if (filingFilters.date_filed_to !== '')
      parts.push(`date_filed_to=${filingFilters.date_filed_to}`);
    if (filingFilters.company.trim() !== '')
      parts.push(`company=${encodeURIComponent(filingFilters.company.trim())}`);
    return apiFetch<PaginatedResponse<ContentSearchResult>>(`/api/search/content?${parts.join('&')}`);
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [contentQuery, searchMode, filingFilters, searchTrigger],
);
```

**Step 6: Conditionally render content results table**

Replace the results section at the bottom of the component. When the content search box has text, show the content results table instead of the tab-specific tables:

```tsx
{/* When content search is active, show content results instead of tab-specific tables */}
{isContentSearch ? (
  <DataTable<ContentSearchResult>
    columns={contentCols}
    defaultOrder="desc"
    defaultSort="score"
    fetchData={fetchContent}
    onRowClick={(row: ContentSearchResult) => void navigate(`/filings/${encodeURIComponent(row.file_number)}`)}
    paramPrefix="c_"
  />
) : (
  <>
    {activeTab === 'filings' && (
      <DataTable<FilingSearchResult>
        columns={filingCols}
        defaultOrder="desc"
        defaultSort="date_filed"
        fetchData={fetchFilings}
        onRowClick={onFilingClick}
        paramPrefix="f_"
      />
    )}
    {activeTab === 'satellites' && (
      <DataTable<SatelliteSearchResult>
        columns={satelliteCols}
        defaultOrder="asc"
        defaultSort="us_name"
        fetchData={fetchSatellites}
        onRowClick={onSatelliteClick}
        paramPrefix="s_"
      />
    )}
    {activeTab === 'earth-stations' && (
      <DataTable<EarthStationSearchResult>
        columns={earthStationCols}
        defaultOrder="asc"
        defaultSort="callsign"
        fetchData={fetchEarthStations}
        onRowClick={onEarthStationClick}
        paramPrefix="e_"
      />
    )}
  </>
)}
```

**Step 7: Update handleClear to also clear content query**

In the `handleClear` callback, add:
```typescript
setContentQuery('');
```

**Step 8: Manual testing**

1. Start dev servers: `./daily-orbit serve api --watch` and `./daily-orbit serve html`
2. Navigate to `/search`
3. Type "Ka-band satellite" in the content search box, press Enter or click Search
4. Verify: content results table appears with File Number, Source, Applicant, Match (snippet with highlighted terms), Date Filed, Relevance columns
5. Verify: existing filters (subsystem, date range, etc.) narrow the content results
6. Verify: snippets render with highlighted `<mark>` terms
7. Clear the content search box — verify existing tab-based filtered browse returns

**Step 9: Commit**

```bash
git add packages/web/src/search/SearchPage.tsx package.json pnpm-lock.yaml
git commit -m "feat(web): add content search box with BM25 ranked results and snippets"
```

---

### Task 7: Pipeline Integration — Rebuild FTS After Ingest

Add FTS index rebuild as a post-processing step in the attachment sync pipeline.

**Files:**
- Modify: `packages/server/src/cli/attachments/sync.ts` (add FTS rebuild call at end)

**Step 1: Add to the sync command**

At the end of the sync pipeline in `sync.ts`, after all stages complete:

```typescript
import { rebuildAllFtsIndexes } from '../../search/fts-index.ts';

// ... at the end of the sync action:
console.log('Rebuilding FTS indexes...');
const ftsStart: number = Date.now();
await rebuildAllFtsIndexes(conn);
console.log(`FTS indexes rebuilt in ${((Date.now() - ftsStart) / 1000).toFixed(1)}s`);
```

**Step 2: Test the full pipeline**

Run: `cd /Users/benton/code/daily-orbit && ./daily-orbit search rebuild-index`
Expected: Indexes rebuild successfully against production data.

**Step 3: Commit**

```bash
git add packages/server/src/cli/attachments/sync.ts
git commit -m "feat(pipeline): rebuild FTS indexes after attachment sync completes"
```

---

### Task 8: Add `score` to Sortable Columns in DataTable

The `score` column from content search needs to be sortable (it's the default sort for content results). Since results come pre-sorted from the API, the DataTable's sort mechanism needs to pass `sort=score` to the API.

**Files:**
- Modify: `packages/server/src/search/content-search.ts` (support sort param)

**Step 1: Add sort support**

The current `searchFilingContent` always sorts by `score DESC`. Extend it to support the standard pagination sort params so that users can re-sort by `date_filed`, `file_number`, etc.

Add a sortable columns set:

```typescript
const CONTENT_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'score', 'file_number', 'date_filed', 'subsystem_code', 'address_attention', 'company_name',
]);
```

In the function, replace the hard-coded `ORDER BY r.score DESC` in the SQL with a dynamic sort:

```typescript
const { sort, order } = normalizePaginatedRequest(pagination);
const sortColumn: string = sort != null && CONTENT_SORTABLE_COLUMNS.has(sort) ? sort : 'score';
// Default to DESC for score, ASC for everything else
const sortOrder: string = sortColumn === 'score' ? (order === 'asc' ? 'asc' : 'desc') : order;
```

Then use `ORDER BY r."${sortColumn}" ${sortOrder}` in the SQL template (column name is validated against the whitelist).

**Step 2: Run existing tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --run packages/server/src/search/content-search.test.ts`
Expected: PASS — all tests still green.

**Step 3: Commit**

```bash
git add packages/server/src/search/content-search.ts
git commit -m "feat(search): support column sorting in content search results"
```

---

## Phase 2: Vector Semantic Search (Future)

These tasks are outlined for planning purposes. Implement after Phase 1 is stable and embeddings are generated.

### Task 9: Embedding Storage Schema

**Files:**
- Create: `packages/server/src/search/embeddings-schema.ts`

Create an `attachment_embedding` table:
```sql
CREATE TABLE IF NOT EXISTS attachment_embedding (
  attachment_key INTEGER PRIMARY KEY,
  embedding FLOAT[1024]
);
```

### Task 10: Bedrock Titan Embed V2 Integration

**Files:**
- Create: `packages/server/src/search/embed.ts`

Use `@aws-sdk/client-bedrock-runtime` (already a project dependency for inference) to call `amazon.titan-embed-text-v2:0` with `dimensions: 1024, normalize: true`.

For long documents (>8192 tokens), implement a chunking strategy: split on paragraph boundaries, embed each chunk, store the chunk with highest relevance or average all chunks.

### Task 11: Batch Embedding Pipeline

**Files:**
- Create: `packages/server/src/cli/search/embed.ts`

CLI command: `./daily-orbit search embed`
- Query all attachments with `full_text IS NOT NULL` and no embedding
- Batch embed with rate limiting (Bedrock throttles at ~100 TPS)
- Upsert into `attachment_embedding`
- Add to Makefile and post-ingest pipeline

### Task 12: HNSW Index and Vector Search

**Files:**
- Modify: `packages/server/src/search/fts-index.ts` (add HNSW rebuild)

```sql
SET hnsw_enable_experimental_persistence = true;
CREATE INDEX IF NOT EXISTS attachment_hnsw
  ON attachment_embedding USING HNSW (embedding)
  WITH (metric = 'cosine');
```

### Task 13: Hybrid Search with RRF

**Files:**
- Modify: `packages/server/src/search/content-search.ts`

When `mode === 'hybrid'` or `mode === 'semantic'`:
1. Generate query embedding via Bedrock
2. Run vector search CTE alongside FTS CTE
3. Fuse with Reciprocal Rank Fusion (k=60)

```sql
CREATE OR REPLACE MACRO rrf(rank, k := 60) AS COALESCE(1.0 / (k + rank), 0);
```

The frontend mode selector (`Keyword | Semantic | Hybrid`) maps directly to which CTEs execute.

### Task 14: Enable Frontend Mode Selector

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`

Remove `disabled` from the "Semantic" and "Hybrid" `<option>` elements. No other frontend changes needed — the API contract is already designed for it.

---

## Summary

| Task | What | Effort |
|------|------|--------|
| 1 | FTS index module + tests | Small |
| 2 | CLI rebuild command + Makefile | Small |
| 3 | Snippet extraction + tests | Small |
| 4 | Content search repository + tests | Medium |
| 5 | API route `/api/search/content` | Small |
| 6 | Frontend search box + content results table | Medium |
| 7 | Pipeline integration (post-ingest rebuild) | Small |
| 8 | Sortable columns for content results | Small |
| 9-14 | Phase 2: Vector/Hybrid search | Future |

Phase 1 (Tasks 1-8) delivers BM25 keyword search across all content with ranked results, snippets, and full filter integration. Phase 2 layers on semantic search via the same API without breaking changes.
