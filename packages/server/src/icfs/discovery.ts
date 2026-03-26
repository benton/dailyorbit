import { processQueue } from '../attachments/queue.ts';
import { getLogger } from '../lib/logger.ts';
import { searchFilings } from './client.ts';
import type { IcfsSearchResult } from './types.ts';

/** Generate array of "YYYY-MM" strings from start to end inclusive */
export function generateMonthRange(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number];

  const months: string[] = [];
  let year: number = fromYear;
  let month: number = fromMonth;

  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${String(year)}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return months;
}

/** Build month-partitioned search queries for a date range */
export function buildDiscoveryQueries(
  subsystems: string[],
  appTypes: string[],
  dateFrom: string,
  dateTo: string,
): string[] {
  const months: string[] = generateMonthRange(dateFrom, dateTo);
  const queries: string[] = [];
  for (const sub of subsystems) {
    for (const app of appTypes) {
      for (const month of months) {
        queries.push(`${sub}-${app}-${month.replace('-', '')}`);
      }
    }
  }
  return queries;
}

/** Subsystem → app types mapping for discovery queries */
export type SubsystemAppTypes = Record<string, string[]>;

/** Build queries from a subsystem-to-app-types map over a date range */
export function buildDiscoveryQueriesFromMap(
  subsystemAppTypes: SubsystemAppTypes,
  dateFrom: string,
  dateTo: string,
): string[] {
  const months: string[] = generateMonthRange(dateFrom, dateTo);
  const queries: string[] = [];
  for (const [sub, appTypes] of Object.entries(subsystemAppTypes)) {
    for (const app of appTypes) {
      for (const month of months) {
        queries.push(`${sub}-${app}-${month.replace('-', '')}`);
      }
    }
  }
  return queries;
}

/** Run all discovery queries and return deduplicated file numbers */
export async function discoverNewFilings(
  queries: string[],
  options?: { delayMs?: number; concurrency?: number },
): Promise<IcfsSearchResult[]> {
  const concurrency: number = options?.concurrency ?? 1;

  const batches: (IcfsSearchResult[] | undefined)[] = await processQueue(
    queries,
    async (query: string): Promise<IcfsSearchResult[]> => searchFilings(query),
    {
      concurrency,
      delayMs: options?.delayMs ?? 0,
      onError: (error: unknown, query: string) => {
        getLogger().error(
          `Discovery query failed: ${query} — ${String(error)}`,
        );
      },
    },
  );

  const seen: Set<string> = new Set();
  const results: IcfsSearchResult[] = [];

  for (const batch of batches) {
    if (batch == null) continue;
    for (const r of batch) {
      if (r.fileNumber.startsWith('DRAFT-')) continue;
      if (!seen.has(r.fileNumber)) {
        seen.add(r.fileNumber);
        results.push(r);
      }
    }
  }

  return results;
}
