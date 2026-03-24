import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create newspaper-related tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureNewspaperTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(
    `CREATE SEQUENCE IF NOT EXISTS newspaper_edition_id_seq START 1`,
  );

  await conn.run(`
    CREATE TABLE IF NOT EXISTS newspaper_edition (
      id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_edition_id_seq'),
      edition_date    DATE NOT NULL UNIQUE,
      edition_type    VARCHAR NOT NULL DEFAULT 'daily',
      status          VARCHAR NOT NULL DEFAULT 'pending',
      pipeline_run_id INTEGER,
      hero_image_path VARCHAR,
      created_at      TIMESTAMP DEFAULT current_timestamp,
      updated_at      TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(
    `CREATE SEQUENCE IF NOT EXISTS newspaper_article_id_seq START 1`,
  );

  await conn.run(`
    CREATE TABLE IF NOT EXISTS newspaper_article (
      id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_article_id_seq'),
      edition_id      INTEGER NOT NULL,
      content_type    VARCHAR NOT NULL,
      slug            VARCHAR NOT NULL,
      headline        VARCHAR,
      body            VARCHAR NOT NULL,
      source_data     VARCHAR,
      generated_by    VARCHAR,
      image_path      VARCHAR,
      image_prompt    VARCHAR,
      display_order   INTEGER NOT NULL DEFAULT 0,
      status          VARCHAR NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMP DEFAULT current_timestamp,
      updated_at      TIMESTAMP DEFAULT current_timestamp,
      UNIQUE (edition_id, slug)
    )
  `);

  await conn.run(
    `CREATE SEQUENCE IF NOT EXISTS newspaper_image_id_seq START 1`,
  );

  await conn.run(`
    CREATE TABLE IF NOT EXISTS newspaper_image (
      id              INTEGER PRIMARY KEY DEFAULT nextval('newspaper_image_id_seq'),
      image_type      VARCHAR NOT NULL,
      image_path      VARCHAR NOT NULL UNIQUE,
      prompt          VARCHAR,
      tags            VARCHAR[],
      generated_by    VARCHAR,
      created_at      TIMESTAMP DEFAULT current_timestamp
    )
  `);
}
