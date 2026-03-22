import { DuckDBConnection } from '@duckdb/node-api';
import type { DuckDBInstance } from '@duckdb/node-api';
import { trackConnection } from './graceful-shutdown.ts';
import { ensureCompanyTables, ensureCompanyFk } from '../companies/schema.ts';
import { ensureAuthTables } from '../user/schema.ts';
import { ensureUserSettingsTables } from '../user-settings/schema.ts';
import { ensureViewingHistoryTables } from '../viewing-history/schema.ts';
import { ensureAttributionColumns } from './attribution-schema.ts';
import { ensureEmbeddingSchema } from '../search/embedding-schema.ts';
import { ensureNewsTables } from '../news/schema.ts';
import { ensureConsultantTables } from '../consultant/schema.ts';
import { ensureChatTables } from '../chat/schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureInferenceLogTable } from '../inference/schema.ts';

/**
 * Initialize a fresh database with the base schema.
 * Called only when starting from a clean DB.
 */
export async function initializeDatabase(db: DuckDBInstance): Promise<void> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS config (
      key       VARCHAR PRIMARY KEY,
      value     VARCHAR NOT NULL,
      encrypted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await ensureAuthTables(conn);
  await ensureUserSettingsTables(conn);
  await ensureViewingHistoryTables(conn);
  await ensureCompanyTables(conn);
  await ensureCompanyFk(conn);
  await ensureAttributionColumns(conn);
  await ensureEmbeddingSchema(conn);
  await ensureNewsTables(conn);
  await ensureConsultantTables(conn);
  await ensureChatTables(conn);
  await ensureSavedSearchTables(conn);
  await ensureInferenceLogTable(conn);

  conn.closeSync();
}
