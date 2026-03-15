import type { ArgDef } from 'citty';
import { type FileNumber, normalizeFileNumber } from '../../lib/file-number.ts';

export const databaseArg = {
  type: 'string',
  description: 'Path to DuckDB database file',
  default: 'data/daily-orbit.duckdb',
} as const satisfies ArgDef;

export const storagePathArg = {
  type: 'string',
  description: 'Base path for attachment file storage',
  default: 'data/attachments',
} as const satisfies ArgDef;

export const scopeArgs = {
  filing: {
    type: 'string',
    description: 'Comma-separated compact file numbers',
  },
  subsystem: {
    type: 'string',
    description: 'Comma-separated subsystem codes (SAT, SES, etc.)',
  },
  'date-from': {
    type: 'string',
    description: 'Start date YYYY-MM-DD or YYYY-MM',
  },
  'date-to': {
    type: 'string',
    description: 'End date YYYY-MM-DD or YYYY-MM',
  },
  limit: {
    type: 'string',
    description: 'Max filings to process',
  },
} as const satisfies Record<string, ArgDef>;

export const requestArgs = {
  delay: {
    type: 'string',
    description: 'Delay between requests in ms',
    default: '500',
  },
  concurrency: {
    type: 'string',
    description: 'Number of concurrent requests',
    default: '1',
  },
} as const satisfies Record<string, ArgDef>;

/**
 * Parse a comma-separated string of file numbers into normalized FileNumber[].
 * Skips values that cannot be normalized and logs a warning.
 */
export function parseFileNumbers(
  raw: string | undefined,
): FileNumber[] | undefined {
  if (raw == null) return undefined;
  const results: FileNumber[] = [];
  for (const s of raw.split(',')) {
    const result = normalizeFileNumber(s.trim());
    if (result.ok) {
      results.push(result.fileNumber);
    } else {
      console.warn(`Skipping unparseable file number: ${s.trim()}`);
    }
  }
  return results.length > 0 ? results : undefined;
}
