import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  closeAll,
  trackConnection,
  trackInstance,
} from '../lib/graceful-shutdown.ts';

const rootDir: string = resolve(import.meta.dirname, '../../../..');
const DB_PATH: string = resolve(
  rootDir,
  process.argv[2] ?? 'data/daily-orbit.duckdb',
);

const db: DuckDBInstance = await DuckDBInstance.create(DB_PATH);
trackInstance(db);
const conn = await db.connect();
trackConnection(conn);

// Add column if missing
await conn.run(
  `ALTER TABLE filing ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP`,
);

// Backfill: set last_scraped_at for filings that have discovered attachments
await conn.run(`
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

closeAll();
process.exit(0);
