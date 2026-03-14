import type { ArgDef } from 'citty';

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
