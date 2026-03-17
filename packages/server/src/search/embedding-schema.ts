import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Install and load the DuckDB VSS extension.
 * Idempotent — safe to call multiple times per connection.
 */
export async function loadVssExtension(conn: DuckDBConnection): Promise<void> {
  await conn.run(`INSTALL vss; LOAD vss;`);
  // Required for HNSW indexes on persistent (on-disk) databases
  await conn.run(`SET hnsw_enable_experimental_persistence = true;`);
}

/**
 * Create the embedding table and HNSW index for vector similarity search.
 * Loads the `vss` extension automatically.
 * Idempotent — safe to call multiple times.
 */
export async function ensureEmbeddingSchema(
  conn: DuckDBConnection,
): Promise<void> {
  await loadVssExtension(conn);

  await conn.run(`CREATE SEQUENCE IF NOT EXISTS embedding_id_seq`);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS embedding (
      embedding_id  INTEGER PRIMARY KEY DEFAULT nextval('embedding_id_seq'),
      source_table  VARCHAR NOT NULL,
      source_key    VARCHAR NOT NULL,
      chunk_index   INTEGER NOT NULL DEFAULT 0,
      embedding     FLOAT[512],
      model_id      VARCHAR NOT NULL,
      text_checksum VARCHAR,
      created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
      UNIQUE (source_table, source_key, chunk_index)
    )
  `);

  // Migration for existing tables
  await conn.run(
    `ALTER TABLE embedding ADD COLUMN IF NOT EXISTS text_checksum VARCHAR`,
  );

  // HNSW index for cosine similarity
  await conn.run(`
    CREATE INDEX IF NOT EXISTS embedding_hnsw_idx
      ON embedding USING HNSW (embedding)
      WITH (metric = 'cosine')
  `);
}
