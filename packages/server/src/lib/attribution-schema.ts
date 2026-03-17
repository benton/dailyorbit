import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Add LLM attribution columns (summarized_by/at, indexed_by/at) to source tables.
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 * No-ops if a target table does not yet exist.
 */
export async function ensureAttributionColumns(
  conn: DuckDBConnection,
): Promise<void> {
  for (const table of ['attachment', 'filing', 'pleading']) {
    const exists = await conn.runAndReadAll(
      `SELECT 1 FROM information_schema.tables WHERE table_name = '${table}' LIMIT 1`,
    );
    if (exists.getRowObjectsJS().length === 0) continue;

    await conn.run(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS indexed_by VARCHAR`,
    );
    await conn.run(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP`,
    );
  }

  // attachment also gets summarized_by / summarized_at
  const attachmentExists = await conn.runAndReadAll(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'attachment' LIMIT 1`,
  );
  if (attachmentExists.getRowObjectsJS().length > 0) {
    await conn.run(
      `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summarized_by VARCHAR`,
    );
    await conn.run(
      `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summarized_at TIMESTAMP`,
    );
  }
}
