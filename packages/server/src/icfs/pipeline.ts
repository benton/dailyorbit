import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getFilingDetail } from './client.ts';
import { buildDiscoveryQueries, discoverNewFilings } from './discovery.ts';
import { upsertIcfsFiling } from './repository.ts';
import { ensureIcfsColumns } from './schema.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';

export type IcfsIngestOptions = {
  dbInstance: DuckDBInstance;
  /** Subsystems to discover (default: ["SAT", "SES"]) */
  subsystems?: string[];
  /** Application types to discover */
  appTypes?: string[];
  /** Start month "YYYY-MM" */
  dateFrom: string;
  /** End month "YYYY-MM" */
  dateTo: string;
  /** Specific file numbers to fetch (skips search-based discovery) */
  fileNumbers?: string[];
  /** Delay between API requests in ms (default: 500) */
  delayMs?: number;
  onProgress?: (msg: string) => void;
};

export type IcfsIngestResult = {
  filingsDiscovered: number;
  filingsIngested: number;
  filingsNotFound: number;
  filingsFailed: number;
  durationMs: number;
};

const DEFAULT_SUBSYSTEMS: string[] = ['SAT', 'SES'];
const DEFAULT_APP_TYPES: string[] = [
  'LOA',
  'MOD',
  'STA',
  'AMD',
  'T/C',
  'ASG',
  'LIC',
  'RWL',
];

export async function runIcfsIngest(
  options: IcfsIngestOptions,
): Promise<IcfsIngestResult> {
  const start: number = Date.now();
  const log = options.onProgress ?? (() => {});
  const delayMs: number = options.delayMs ?? 500;

  const conn: DuckDBConnection = await options.dbInstance.connect();

  try {
    // 1. Ensure schema is ready
    log('Ensuring ICFS schema columns...');
    await ensureIcfsColumns(conn);

    // 2. Discover file numbers or use provided list
    let fileNumbers: string[];

    if (options.fileNumbers != null && options.fileNumbers.length > 0) {
      fileNumbers = options.fileNumbers;
      log(`Using ${String(fileNumbers.length)} provided file number(s)`);
    } else {
      const subsystems: string[] = options.subsystems ?? DEFAULT_SUBSYSTEMS;
      const appTypes: string[] = options.appTypes ?? DEFAULT_APP_TYPES;
      const queries: string[] = buildDiscoveryQueries(
        subsystems,
        appTypes,
        options.dateFrom,
        options.dateTo,
      );
      log(
        `Discovering filings: ${String(queries.length)} queries for ${subsystems.join(',')} × ${appTypes.join(',')}`,
      );

      const results: IcfsSearchResult[] = await discoverNewFilings(queries, {
        delayMs,
      });
      fileNumbers = results.map((r) => r.fileNumber);
      log(`Discovered ${String(fileNumbers.length)} unique file number(s)`);
    }

    // 3. Fetch detail for each and upsert
    let ingested: number = 0;
    let notFound: number = 0;
    let failed: number = 0;

    for (let i: number = 0; i < fileNumbers.length; i++) {
      const fileNumber: string = fileNumbers[i]!;
      log(
        `[${String(i + 1)}/${String(fileNumbers.length)}] Fetching ${fileNumber}...`,
      );

      try {
        const detail: IcfsFilingDetail = await getFilingDetail(fileNumber);

        if (!detail.found) {
          log(`  Not found: ${fileNumber}`);
          notFound++;
          continue;
        }

        await upsertIcfsFiling(conn, detail);
        ingested++;
        log(`  Ingested: ${fileNumber}`);
      } catch (err: unknown) {
        failed++;
        log(`  Failed: ${fileNumber} — ${String(err)}`);
      }

      if (i < fileNumbers.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const durationMs: number = Date.now() - start;
    return {
      filingsDiscovered: fileNumbers.length,
      filingsIngested: ingested,
      filingsNotFound: notFound,
      filingsFailed: failed,
      durationMs,
    };
  } finally {
    conn.closeSync();
  }
}
