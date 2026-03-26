import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { processQueue } from '../attachments/queue.ts';
import {
  createAttachmentTable,
  upsertAttachments,
} from '../attachments/repository.ts';
import type { FileNumber } from '../lib/file-number.ts';
import { getFilingDetail } from './client.ts';
import {
  buildDiscoveryQueriesFromMap,
  discoverNewFilings,
  type SubsystemAppTypes,
} from './discovery.ts';
import {
  createPleadingTable,
  icfsAttachmentsToMetadata,
  icfsPleadingsToRows,
  migrateLegacyPetitions,
  upsertIcfsFiling,
  upsertPleadings,
} from './repository.ts';
import { ensureIcfsColumns } from './schema.ts';
import {
  computeSnapshotHash,
  ensureDiscoverySnapshotTable,
  getLatestSnapshot,
  saveSnapshot,
} from './snapshot-repository.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';

export type IcfsIngestOptions = {
  dbInstance: DuckDBInstance;
  /** Per-subsystem app type overrides; merged with defaults */
  subsystemAppTypes?: SubsystemAppTypes;
  /** Start month "YYYY-MM" */
  dateFrom: string;
  /** End month "YYYY-MM" */
  dateTo: string;
  /** Specific file numbers to fetch (skips search-based discovery) */
  fileNumbers?: string[];
  /** When true, skip detail-fetch for file numbers already in the DB */
  skipKnown?: boolean;
  /** Pipeline run ID to associate with the discovery snapshot */
  pipelineRunId?: number;
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
  skippedKnown: number;
  durationMs: number;
};

/** Default per-subsystem app types for discovery queries */
export const DEFAULT_SUBSYSTEM_APP_TYPES: SubsystemAppTypes = {
  SAT: ['LOA', 'MOD', 'STA', 'AMD', 'T/C', 'ASG', 'LIC', 'RWL', 'REG'],
  SES: ['LOA', 'MOD', 'STA', 'AMD', 'T/C', 'ASG', 'LIC', 'RWL', 'REG'],
  ITC: [
    '214',
    'T/C',
    'ASG',
    'STA',
    'MOD',
    'TAO',
    'AMD',
    'NTC',
    'MSC',
    'WAV',
    'RPT',
  ],
};

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
    await createAttachmentTable(conn);
    await createPleadingTable(conn);
    await migrateLegacyPetitions(conn);

    // 2. Discover file numbers or use provided list
    let fileNumbers: string[];

    if (options.fileNumbers != null && options.fileNumbers.length > 0) {
      fileNumbers = options.fileNumbers;
      log(`Using ${String(fileNumbers.length)} provided file number(s)`);
    } else {
      const subsystemAppTypes: SubsystemAppTypes =
        options.subsystemAppTypes ?? DEFAULT_SUBSYSTEM_APP_TYPES;

      const queries: string[] = buildDiscoveryQueriesFromMap(
        subsystemAppTypes,
        options.dateFrom,
        options.dateTo,
      );

      const subsystemList: string = Object.entries(subsystemAppTypes)
        .map(([sub, types]) => `${sub}(${String(types.length)})`)
        .join(', ');
      log(
        `Discovering filings: ${String(queries.length)} queries across ${subsystemList}`,
      );

      const results: IcfsSearchResult[] = await discoverNewFilings(queries, {
        delayMs,
        concurrency,
      });
      fileNumbers = results.map((r) => r.fileNumber);
      log(`Discovered ${String(fileNumbers.length)} unique file number(s)`);
    }

    // 2b. Compute and save discovery snapshot
    await ensureDiscoverySnapshotTable(conn);
    const snapshotHash: string = computeSnapshotHash(fileNumbers);

    // 2c. Hash-based short-circuit: if the discovered set is unchanged, skip everything
    if (options.skipKnown === true) {
      const prev = await getLatestSnapshot(conn);
      if (prev != null && prev.snapshot_hash === snapshotHash) {
        await saveSnapshot(conn, snapshotHash, [], 0, options.pipelineRunId);
        const durationMs: number = Date.now() - start;
        log(
          `Snapshot unchanged (${snapshotHash.slice(0, 8)}…), no new filings`,
        );
        return {
          filingsDiscovered: fileNumbers.length,
          filingsIngested: 0,
          filingsNotFound: 0,
          filingsFailed: 0,
          skippedKnown: fileNumbers.length,
          durationMs,
        };
      }
    }

    // 2d. Filter to unknown file numbers when skipKnown is set
    let skippedKnown: number = 0;
    if (options.skipKnown === true && fileNumbers.length > 0) {
      const placeholders: string = fileNumbers.map(() => '?').join(',');
      const knownReader = await conn.runAndReadAll(
        `SELECT file_number FROM filing WHERE file_number IN (${placeholders})`,
        fileNumbers,
      );
      const knownSet: Set<string> = new Set(
        knownReader
          .getRowObjectsJS()
          .map((r) => String((r as Record<string, unknown>).file_number)),
      );
      const allCount: number = fileNumbers.length;
      fileNumbers = fileNumbers.filter((fn) => !knownSet.has(fn));
      skippedKnown = allCount - fileNumbers.length;
      log(
        `skipKnown: ${String(skippedKnown)} known, ${String(fileNumbers.length)} new`,
      );
    }

    await saveSnapshot(
      conn,
      snapshotHash,
      fileNumbers,
      fileNumbers.length,
      options.pipelineRunId,
    );

    if (options.skipKnown === true && fileNumbers.length === 0) {
      const durationMs: number = Date.now() - start;
      return {
        filingsDiscovered: skippedKnown,
        filingsIngested: 0,
        filingsNotFound: 0,
        filingsFailed: 0,
        skippedKnown,
        durationMs,
      };
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

        // Persist attachment + pleading metadata from the same API response
        const hasAttachments: boolean = detail.attachments.length > 0;
        const hasPleadings: boolean = detail.pleadings.length > 0;
        if ((hasAttachments || hasPleadings) && detail.summary != null) {
          const keyResult = await conn.runAndReadAll(
            `SELECT filing_key FROM filing WHERE file_number = $1`,
            [fileNumber],
          );
          const filingKey: number = Number(
            keyResult.getRowObjectsJS()[0]!.filing_key,
          );

          if (hasAttachments) {
            const attMeta = icfsAttachmentsToMetadata(
              detail.attachments,
              filingKey,
              fileNumber as FileNumber,
            );
            await upsertAttachments(conn, attMeta);
          }

          if (hasPleadings) {
            const pleadingRows = icfsPleadingsToRows(
              detail.pleadings,
              filingKey,
              fileNumber as FileNumber,
            );
            await upsertPleadings(conn, pleadingRows);
          }
        }

        ingested++;
      } catch (err: unknown) {
        failed++;
        log(`  DB write failed: ${fileNumber} — ${String(err)}`);
      }
    }

    const durationMs: number = Date.now() - start;
    return {
      filingsDiscovered: fileNumbers.length + skippedKnown,
      filingsIngested: ingested,
      filingsNotFound: notFound,
      filingsFailed: failed,
      skippedKnown,
      durationMs,
    };
  } finally {
    conn.closeSync();
  }
}
