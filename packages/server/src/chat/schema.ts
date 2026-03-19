import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureChatTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS conversation (
      id                  VARCHAR PRIMARY KEY,
      user_id             VARCHAR NOT NULL,
      consultant_id       INTEGER NOT NULL,
      title               VARCHAR,
      total_input_tokens  INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cost_cents    FLOAT DEFAULT 0,
      created_at          TIMESTAMP DEFAULT current_timestamp,
      updated_at          TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_conversation_user_id
    ON conversation(user_id)
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS message (
      id                VARCHAR PRIMARY KEY,
      conversation_id   VARCHAR NOT NULL,
      role              VARCHAR NOT NULL,
      content           TEXT NOT NULL,
      sources           JSON,
      input_tokens      INTEGER,
      output_tokens     INTEGER,
      cost_cents        FLOAT DEFAULT 0,
      model_id          VARCHAR,
      consultant_id     INTEGER,
      sequence          INTEGER NOT NULL,
      created_at        TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_message_conversation_seq
    ON message(conversation_id, sequence)
  `);
}
