import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureConsultantTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS consultant_id_seq START 1`);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS consultant (
      id                  INTEGER PRIMARY KEY DEFAULT nextval('consultant_id_seq'),
      name                VARCHAR NOT NULL,
      slug                VARCHAR NOT NULL UNIQUE,
      description         VARCHAR,
      system_prompt       TEXT NOT NULL,
      model_id            VARCHAR,
      temperature         FLOAT,
      max_response_tokens INTEGER,
      icon                VARCHAR,
      color               VARCHAR,
      sort_order          INTEGER DEFAULT 0,
      enabled             BOOLEAN DEFAULT true,
      archived_at         TIMESTAMP,
      created_at          TIMESTAMP DEFAULT current_timestamp,
      updated_at          TIMESTAMP DEFAULT current_timestamp
    )
  `);
}
