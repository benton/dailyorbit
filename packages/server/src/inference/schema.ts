import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureInferenceLogTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS inference_log_id_seq START 1
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS inference_log (
      id              INTEGER NOT NULL DEFAULT nextval('inference_log_id_seq') PRIMARY KEY,
      model_id        VARCHAR NOT NULL,
      operation       VARCHAR NOT NULL,
      caller          VARCHAR,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      latency_ms      INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMP NOT NULL DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_inference_log_created
    ON inference_log(created_at)
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_inference_log_model
    ON inference_log(model_id)
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_inference_log_caller
    ON inference_log(caller)
  `);
}
