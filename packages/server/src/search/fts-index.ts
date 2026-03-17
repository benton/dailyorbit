import type { DuckDBConnection } from '@duckdb/node-api';

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
];

/**
 * Rebuild all FTS indexes. Call after data ingestion completes.
 * Each index is created with overwrite=1 so it replaces any existing index.
 * Skips tables that don't exist or lack expected columns (e.g. in tests).
 */
export async function rebuildAllFtsIndexes(
  conn: DuckDBConnection,
): Promise<void> {
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
        console.warn(`FTS index skipped for ${def.table}: ${msg}`);
      } else {
        throw err;
      }
    }
  }
}
