import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { processQueue } from '../attachments/queue.ts';
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
  /** Number of concurrent HTTP requests (default: 1) */
  concurrency?: number;
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
  'REG',
];

export async function runIcfsIngest(
  options: IcfsIngestOptions,
): Promise<IcfsIngestResult> {
  const start: number = Date.now();
  const log = options.onProgress ?? (() => {});
  const delayMs: number = options.delayMs ?? 500;
  const concurrency: number = options.concurrency ?? 1;

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
        concurrency,
      });
      fileNumbers = results.map((r) => r.fileNumber);
      log(`Discovered ${String(fileNumbers.length)} unique file number(s)`);
    }

    // 3. Fetch details concurrently
    log(
      `Fetching ${String(fileNumbers.length)} filing details (concurrency: ${String(concurrency)})...`,
    );
    let completedCount: number = 0;
    const fetchErrors: Set<number> = new Set();

    const details: (IcfsFilingDetail | undefined)[] = await processQueue(
      fileNumbers,
      async (fileNumber: string): Promise<IcfsFilingDetail> =>
        getFilingDetail(fileNumber),
      {
        concurrency,
        delayMs,
        onError: (error: unknown, fileNumber: string, index: number) => {
          fetchErrors.add(index);
          log(`  Failed: ${fileNumber} — ${String(error)}`);
        },
        onItemComplete: () => {
          completedCount++;
          if (
            completedCount % 100 === 0 ||
            completedCount === fileNumbers.length
          ) {
            log(
              `  Fetched ${String(completedCount)}/${String(fileNumbers.length)}`,
            );
          }
        },
      },
    );

    // 4. Write to DB sequentially
    let ingested: number = 0;
    let notFound: number = 0;
    let failed: number = fetchErrors.size;

    for (let i: number = 0; i < fileNumbers.length; i++) {
      if (fetchErrors.has(i)) continue;

      const detail: IcfsFilingDetail = details[i]!;
      const fileNumber: string = fileNumbers[i]!;

      if (!detail.found) {
        notFound++;
        continue;
      }

      try {
        await upsertIcfsFiling(conn, detail);
        ingested++;
      } catch (err: unknown) {
        failed++;
        log(`  DB write failed: ${fileNumber} — ${String(err)}`);
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
