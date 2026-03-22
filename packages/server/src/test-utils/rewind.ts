import type { DuckDBConnection } from '@duckdb/node-api';

/** Options for the rewind operation. */
export interface RewindOptions {
  /** Remove filings with _first_seen_at >= this date (YYYY-MM-DD). Mutually exclusive with `last`. */
  since?: string | undefined;
  /** Remove the N most recently ingested filings. Mutually exclusive with `since`. */
  last?: number | undefined;
  /** Also delete embeddings and rebuild FTS index. */
  full?: boolean | undefined;
  /** Print counts but don't execute deletions. */
  dryRun?: boolean | undefined;
}

/** Per-table deletion counts returned by rewind. */
export interface RewindResult {
  scope: string;
  counts: TableCount[];
  fullCounts?: TableCount[];
}

export interface TableCount {
  table: string;
  count: number | 'rebuild';
}

/**
 * Compute the set of filing keys and file numbers to rewind,
 * plus per-table row counts that would be deleted.
 */
export async function planRewind(
  conn: DuckDBConnection,
  opts: RewindOptions,
): Promise<RewindResult> {
  validateOptions(opts);

  await createTargetSet(conn, opts);

  const scope: string = opts.since
    ? `filings with _first_seen_at >= ${opts.since}`
    : `${opts.last} most recently ingested filings`;

  const counts: TableCount[] = await countDeletions(conn);
  const fullCounts: TableCount[] = opts.full
    ? await countFullDeletions(conn)
    : await countFullDeletions(conn); // always compute for dry-run display

  return { scope, counts, fullCounts };
}

/**
 * Execute the rewind: delete rows in FK-safe order within a single transaction.
 * Returns actual deletion counts.
 */
export async function executeRewind(
  conn: DuckDBConnection,
  opts: RewindOptions,
): Promise<RewindResult> {
  validateOptions(opts);

  await createTargetSet(conn, opts);

  const scope: string = opts.since
    ? `filings with _first_seen_at >= ${opts.since}`
    : `${opts.last} most recently ingested filings`;

  // Delete in FK-safe order within a transaction
  await conn.run('BEGIN TRANSACTION');
  try {
    // Full deletions must run first — they reference attachment/pleading rows
    // that deleteDependentRows will remove
    const fullCounts: TableCount[] = opts.full
      ? await deleteFullRows(conn)
      : [];
    const counts: TableCount[] = await deleteDependentRows(conn);

    await conn.run('COMMIT');
    return { scope, counts, fullCounts };
  } catch (err: unknown) {
    await conn.run('ROLLBACK');
    throw err;
  }
}

function validateOptions(opts: RewindOptions): void {
  if (opts.since != null && opts.last != null) {
    throw new Error('--since and --last are mutually exclusive');
  }
  if (opts.since == null && opts.last == null) {
    throw new Error('One of --since or --last is required');
  }
  if (opts.last != null && opts.last <= 0) {
    throw new Error('--last must be a positive integer');
  }
}

async function createTargetSet(
  conn: DuckDBConnection,
  opts: RewindOptions,
): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS rewind_filings');

  if (opts.since != null) {
    await conn.run(
      `CREATE TEMP TABLE rewind_filings AS
         SELECT file_number, filing_key FROM filing
         WHERE _first_seen_at >= ?`,
      [opts.since],
    );
  } else {
    await conn.run(
      `CREATE TEMP TABLE rewind_filings AS
         SELECT file_number, filing_key FROM filing
         ORDER BY _first_seen_at DESC LIMIT ?`,
      [opts.last!],
    );
  }
}

async function countForTable(
  conn: DuckDBConnection,
  sql: string,
): Promise<number> {
  const result = await conn.runAndReadAll(sql);
  const rows = result.getRows();
  return Number(rows[0]?.[0] ?? 0);
}

async function countDeletions(conn: DuckDBConnection): Promise<TableCount[]> {
  const alertRunCount: number = await countForTable(
    conn,
    'SELECT count(*) FROM alert_run',
  );
  const contentFlagCount: number = await countForTable(
    conn,
    `SELECT count(*) FROM user_content_flag
     WHERE content_type = 'filing'
       AND content_key IN (SELECT file_number FROM rewind_filings)`,
  );
  const viewCount: number = await countForTable(
    conn,
    `SELECT count(*) FROM user_filing_view
     WHERE file_number IN (SELECT file_number FROM rewind_filings)`,
  );
  const pleadingCount: number = await countForTable(
    conn,
    `SELECT count(*) FROM pleading
     WHERE filing_key IN (SELECT filing_key FROM rewind_filings)`,
  );
  const attachmentCount: number = await countForTable(
    conn,
    `SELECT count(*) FROM attachment
     WHERE filing_key IN (SELECT filing_key FROM rewind_filings)`,
  );
  const filingCount: number = await countForTable(
    conn,
    'SELECT count(*) FROM rewind_filings',
  );

  return [
    { table: 'filing', count: filingCount },
    { table: 'attachment', count: attachmentCount },
    { table: 'pleading', count: pleadingCount },
    { table: 'user_filing_view', count: viewCount },
    { table: 'user_content_flag', count: contentFlagCount },
    { table: 'alert_run', count: alertRunCount },
  ];
}

async function countFullDeletions(
  conn: DuckDBConnection,
): Promise<TableCount[]> {
  // Check if embedding table exists
  const hasEmbedding: boolean = await tableExists(conn, 'embedding');
  if (!hasEmbedding) {
    return [
      { table: 'embedding', count: 0 },
      { table: 'FTS index', count: 'rebuild' },
    ];
  }

  const embeddingCount: number = await countForTable(
    conn,
    `SELECT count(*) FROM embedding
     WHERE (source_table = 'filing' AND source_key IN (SELECT CAST(filing_key AS VARCHAR) FROM rewind_filings))
        OR (source_table = 'attachment' AND source_key IN (
              SELECT CAST(attachment_key AS VARCHAR) FROM attachment
              WHERE filing_key IN (SELECT filing_key FROM rewind_filings)))
        OR (source_table = 'pleading' AND source_key IN (
              SELECT CAST(pleading_key AS VARCHAR) FROM pleading
              WHERE filing_key IN (SELECT filing_key FROM rewind_filings)))`,
  );

  return [
    { table: 'embedding', count: embeddingCount },
    { table: 'FTS index', count: 'rebuild' },
  ];
}

async function tableExists(
  conn: DuckDBConnection,
  tableName: string,
): Promise<boolean> {
  const result = await conn.runAndReadAll(
    `SELECT count(*) FROM information_schema.tables WHERE table_name = ?`,
    [tableName],
  );
  return Number(result.getRows()[0]?.[0] ?? 0) > 0;
}

async function deleteAndCount(
  conn: DuckDBConnection,
  table: string,
  condition: string,
): Promise<number> {
  // DuckDB doesn't support DELETE ... RETURNING count, so count first then delete
  const countResult = await conn.runAndReadAll(
    `SELECT count(*) FROM ${table} WHERE ${condition}`,
  );
  const count: number = Number(countResult.getRows()[0]?.[0] ?? 0);
  if (count > 0) {
    await conn.run(`DELETE FROM ${table} WHERE ${condition}`);
  }
  return count;
}

async function deleteDependentRows(
  conn: DuckDBConnection,
): Promise<TableCount[]> {
  // Step 1: alert_run — delete all rows (resets watermarks)
  const alertCount: number = await deleteAndCount(conn, 'alert_run', '1=1');

  // Step 2: user_content_flag
  const flagCount: number = await deleteAndCount(
    conn,
    'user_content_flag',
    `content_type = 'filing' AND content_key IN (SELECT file_number FROM rewind_filings)`,
  );

  // Step 3: user_filing_view
  const viewCount: number = await deleteAndCount(
    conn,
    'user_filing_view',
    'file_number IN (SELECT file_number FROM rewind_filings)',
  );

  // Step 4: pleading
  const pleadingCount: number = await deleteAndCount(
    conn,
    'pleading',
    'filing_key IN (SELECT filing_key FROM rewind_filings)',
  );

  // Step 5: attachment
  const attachmentCount: number = await deleteAndCount(
    conn,
    'attachment',
    'filing_key IN (SELECT filing_key FROM rewind_filings)',
  );

  // Step 6: filing
  const filingCount: number = await deleteAndCount(
    conn,
    'filing',
    'filing_key IN (SELECT filing_key FROM rewind_filings)',
  );

  return [
    { table: 'alert_run', count: alertCount },
    { table: 'user_content_flag', count: flagCount },
    { table: 'user_filing_view', count: viewCount },
    { table: 'pleading', count: pleadingCount },
    { table: 'attachment', count: attachmentCount },
    { table: 'filing', count: filingCount },
  ];
}

async function deleteFullRows(conn: DuckDBConnection): Promise<TableCount[]> {
  const hasEmbedding: boolean = await tableExists(conn, 'embedding');
  if (!hasEmbedding) {
    return [];
  }

  // Step 7: embedding
  const embeddingCount: number = await deleteAndCount(
    conn,
    'embedding',
    `(source_table = 'filing' AND source_key IN (SELECT CAST(filing_key AS VARCHAR) FROM rewind_filings))
     OR (source_table = 'attachment' AND source_key IN (
           SELECT CAST(attachment_key AS VARCHAR) FROM attachment
           WHERE filing_key IN (SELECT filing_key FROM rewind_filings)))
     OR (source_table = 'pleading' AND source_key IN (
           SELECT CAST(pleading_key AS VARCHAR) FROM pleading
           WHERE filing_key IN (SELECT filing_key FROM rewind_filings)))`,
  );

  // Step 8: FTS rebuild — we don't rebuild here, just signal it
  // The CLI layer will handle the actual FTS rebuild

  const result: TableCount[] = [{ table: 'embedding', count: embeddingCount }];
  return result;
}
