import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create news-related tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureNewsTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS news_source_id_seq START 1`);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS news_source (
      id                     INTEGER PRIMARY KEY DEFAULT nextval('news_source_id_seq'),
      name                   VARCHAR NOT NULL,
      feed_url               VARCHAR NOT NULL UNIQUE,
      category               VARCHAR NOT NULL DEFAULT 'industry',
      enabled                BOOLEAN NOT NULL DEFAULT TRUE,
      fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
      last_fetched_at        TIMESTAMP,
      last_fetch_status      VARCHAR,
      last_fetch_error       VARCHAR,
      created_at             TIMESTAMP DEFAULT current_timestamp,
      updated_at             TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`CREATE SEQUENCE IF NOT EXISTS news_item_id_seq START 1`);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS news_item (
      id              INTEGER PRIMARY KEY DEFAULT nextval('news_item_id_seq'),
      news_source_id  INTEGER NOT NULL,
      source_url      VARCHAR NOT NULL,
      title           VARCHAR NOT NULL,
      author          VARCHAR,
      published_at    TIMESTAMP,
      fetched_at      TIMESTAMP DEFAULT current_timestamp,
      full_text       VARCHAR,
      text_length     INTEGER,
      text_checksum   VARCHAR,
      summary         VARCHAR,
      summarized_by   VARCHAR,
      summarized_at   TIMESTAMP,
      extract_status  VARCHAR NOT NULL DEFAULT 'pending',
      company_id      INTEGER,
      tags            VARCHAR[],
      indexed_by      VARCHAR,
      indexed_at      TIMESTAMP,
      created_at      TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(
    `ALTER TABLE news_item ADD COLUMN IF NOT EXISTS company_match_attempted_at TIMESTAMP`,
  );

  await conn.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_news_item_source_url ON news_item(source_url)`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_news_item_text_checksum ON news_item(text_checksum)`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_news_item_extract_status ON news_item(extract_status)`,
  );
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_news_item_company_id ON news_item(company_id)`,
  );
}
