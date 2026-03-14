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

/** Run all discovery queries and return deduplicated file numbers */
export async function discoverNewFilings(
  queries: string[],
  options?: { delayMs?: number },
): Promise<IcfsSearchResult[]> {
  const seen: Set<string> = new Set();
  const results: IcfsSearchResult[] = [];

  for (const query of queries) {
    const batch: IcfsSearchResult[] = await searchFilings(query);
    for (const r of batch) {
      if (!seen.has(r.fileNumber)) {
        seen.add(r.fileNumber);
        results.push(r);
      }
    }
    if (options?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  return results;
}
