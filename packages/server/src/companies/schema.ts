import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create company-related tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureCompanyTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS company_id_seq START 1
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS company (
      id              INTEGER PRIMARY KEY DEFAULT nextval('company_id_seq'),
      name            VARCHAR NOT NULL,
      parent_company_id INTEGER,
      stock_ticker    VARCHAR,
      stock_exchange  VARCHAR,
      industry        VARCHAR,
      logo_url        VARCHAR,
      website         VARCHAR,
      description     VARCHAR,
      gleif_lei       VARCHAR,
      wikidata_id     VARCHAR,
      created_at      TIMESTAMP DEFAULT current_timestamp,
      updated_at      TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS company_alias (
      company_id  INTEGER NOT NULL,
      alias_name  VARCHAR NOT NULL,
      alias_type  VARCHAR NOT NULL DEFAULT 'legal_name',
      PRIMARY KEY (company_id, alias_name)
    )
  `);

  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS ownership_event_id_seq START 1
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS ownership_event (
      event_id              INTEGER PRIMARY KEY DEFAULT nextval('ownership_event_id_seq'),
      filing_file_number    VARCHAR NOT NULL,
      transferor_company_id INTEGER,
      transferee_company_id INTEGER,
      effective_date        DATE,
      event_type            VARCHAR NOT NULL,
      status                VARCHAR NOT NULL DEFAULT 'unknown',
      description           VARCHAR
    )
  `);
}

/**
 * Add company_id foreign key column to the filing table.
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 * No-ops if the filing table does not yet exist.
 */
export async function ensureCompanyFk(conn: DuckDBConnection): Promise<void> {
  const tableCheck = await conn.runAndReadAll(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'filing' LIMIT 1`,
  );
  if (tableCheck.getRowObjectsJS().length === 0) return;

  await conn.run(
    `ALTER TABLE filing ADD COLUMN IF NOT EXISTS company_id INTEGER`,
  );
  await conn.run(
    `ALTER TABLE filing ADD COLUMN IF NOT EXISTS company_match_attempted_at TIMESTAMP`,
  );
  await conn.run(
    `ALTER TABLE filing ADD COLUMN IF NOT EXISTS ownership_match_attempted_at TIMESTAMP`,
  );
}
