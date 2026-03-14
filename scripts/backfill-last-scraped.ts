import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH: string = process.argv[2] ?? 'data/daily-orbit.duckdb';

const db: DuckDBInstance = await DuckDBInstance.create(DB_PATH);
const conn = await db.connect();

// Add column if missing
await conn.run(
  `ALTER TABLE filing ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP`,
);

// Backfill: set last_scraped_at for filings that have discovered attachments
const result = await conn.runAndReadAll(`
  UPDATE filing
  SET last_scraped_at = current_timestamp
  WHERE filing_key IN (SELECT DISTINCT filing_key FROM attachment)
    AND last_scraped_at IS NULL
`);

const countReader = await conn.runAndReadAll(`
  SELECT
    COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) AS scraped,
    COUNT(*) FILTER (WHERE last_scraped_at IS NULL) AS unscraped,
    COUNT(*) AS total
  FROM filing
`);
const row = countReader.getRowObjectsJS()[0]!;
console.log(
  `Backfill complete: ${String(row.scraped)} scraped, ${String(row.unscraped)} unscraped, ${String(row.total)} total filings`,
);

conn.closeSync();
process.exit(0);
