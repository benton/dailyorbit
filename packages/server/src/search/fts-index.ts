import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getConfigValue, setConfigValue } from '../lib/config-repository.ts';
import { getLogger } from '../lib/logger.ts';

type FtsIndexDef = {
  table: string;
  keyColumn: string;
  textColumns: string[];
};

const FTS_INDEXES: ReadonlyArray<FtsIndexDef> = [
  {
    table: 'filing',
    keyColumn: 'file_number',
    textColumns: ['description', 'brief_description'],
  },
  {
    table: 'attachment',
    keyColumn: 'attachment_key',
    textColumns: ['full_text', 'summary'],
  },
  {
    table: 'pleading',
    keyColumn: 'pleading_key',
    textColumns: ['filer_name', 'exhibit_attachment_html'],
  },
  {
    table: 'news_item',
    keyColumn: 'id',
    textColumns: ['title', 'full_text', 'summary'],
  },
];

const FTS_FINGERPRINT_KEY: string = 'fts_fingerprint';

/**
 * Compute a fingerprint of the current data based on row counts.
 * Used to detect whether FTS indexes need to be rebuilt.
 */
async function computeFtsFingerprint(conn: DuckDBConnection): Promise<string> {
  const counts: Record<string, number> = {};
  for (const def of FTS_INDEXES) {
    try {
      const r = await conn.runAndReadAll(
        `SELECT COUNT(*)::INTEGER AS cnt FROM ${def.table}`,
      );
      counts[def.table] = Number(r.getRowObjectsJS()[0]?.cnt ?? 0);
    } catch {
      counts[def.table] = -1; // table doesn't exist
    }
  }
  return JSON.stringify(counts);
}

/**
 * Rebuild all FTS indexes. Call after data ingestion completes.
 * Each index is created with overwrite=1 so it replaces any existing index.
 * Skips tables that don't exist or lack expected columns (e.g. in tests).
 *
 * When `db` is provided, compares a row-count fingerprint against the stored
 * value and skips the rebuild if nothing has changed. Pass `force: true` to
 * bypass the check.
 */
export async function rebuildAllFtsIndexes(
  conn: DuckDBConnection,
  db?: DuckDBInstance,
  force?: boolean,
): Promise<{ skipped: boolean }> {
  // Fingerprint-based skip when db is available
  if (db != null && force !== true) {
    const currentFingerprint: string = await computeFtsFingerprint(conn);
    const stored = await getConfigValue(db, FTS_FINGERPRINT_KEY);
    if (stored != null && stored.value === currentFingerprint) {
      return { skipped: true };
    }
  }

  await conn.run(`INSTALL fts; LOAD fts;`);

  for (const def of FTS_INDEXES) {
    const cols: string = def.textColumns
      .map((c: string) => `'${c}'`)
      .join(', ');
    try {
      await conn.run(`
        PRAGMA create_fts_index(
          '${def.table}', '${def.keyColumn}',
          ${cols},
          stemmer = 'english',
          stopwords = 'english',
          lower = 1,
          overwrite = 1
        )
      `);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      // Skip if table/column doesn't exist (common in test environments)
      if (
        msg.includes('does not have a column') ||
        msg.includes('does not exist')
      ) {
        getLogger().warn(`FTS index skipped for ${def.table}: ${msg}`);
      } else {
        throw err;
      }
    }
  }

  // Save fingerprint after successful rebuild
  if (db != null) {
    const newFingerprint: string = await computeFtsFingerprint(conn);
    await setConfigValue(db, FTS_FINGERPRINT_KEY, newFingerprint, false);
  }

  return { skipped: false };
}
