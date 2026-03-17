import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Rebuild all FTS indexes. Call after data ingestion completes.
 * Each index is created with overwrite=1 so it replaces any existing index.
 */
export async function rebuildAllFtsIndexes(
  conn: DuckDBConnection,
): Promise<void> {
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
