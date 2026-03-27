import { Hono } from 'hono';
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs';
import { getLogger } from '../lib/logger.ts';
// Import JSON directly so the bundler inlines it (no runtime fs read)
import queriesFile from '../../debugscripts/cwl-queries.json' with { type: 'json' };

const logger = getLogger().child({ module: 'logs' });

// --- Query definitions from shared JSON ---

type QueryDef = {
  defaultHours: number;
  description: string;
  query: string;
};

const logGroup: string = queriesFile.logGroup;
const queries: Record<string, QueryDef> = queriesFile.queries as Record<
  string,
  QueryDef
>;

const VALID_QUERY_NAMES: Set<string> = new Set(Object.keys(queries));

/** Queries that require a user-supplied {arg} parameter */
function queryNeedsArg(name: string): boolean {
  const def: QueryDef | undefined = queries[name];
  return def != null && def.query.includes('{arg}');
}

// --- CWL client (lazy singleton) ---

let cwlClient: CloudWatchLogsClient | null = null;
function getCwlClient(): CloudWatchLogsClient {
  if (cwlClient == null) {
    cwlClient = new CloudWatchLogsClient({});
  }
  return cwlClient;
}

const POLL_INTERVAL_MS: number = 1000;
const MAX_POLL_ATTEMPTS: number = 60;

// --- Routes ---

const logsRoutes = new Hono();

/** GET / — list available query definitions */
logsRoutes.get('/queries', (c) => {
  const result: Array<{
    name: string;
    description: string;
    defaultHours: number;
    needsArg: boolean;
  }> = Object.entries(queries).map(([name, def]) => ({
    name,
    description: def.description,
    defaultHours: def.defaultHours,
    needsArg: queryNeedsArg(name),
  }));
  return c.json(result);
});

/** GET / — run a CWL Insights query and return results */
logsRoutes.get('/', async (c) => {
  const queryName: string | undefined = c.req.query('query');
  const hoursStr: string | undefined = c.req.query('hours');
  const arg: string | undefined = c.req.query('arg');

  if (queryName == null || !VALID_QUERY_NAMES.has(queryName)) {
    return c.json(
      {
        error: `Invalid query name. Valid names: ${[...VALID_QUERY_NAMES].join(', ')}`,
      },
      400,
    );
  }

  const def: QueryDef = queries[queryName]!;

  if (queryNeedsArg(queryName) && (arg == null || arg.trim() === '')) {
    return c.json(
      { error: `Query "${queryName}" requires an 'arg' parameter` },
      400,
    );
  }

  const hours: number = hoursStr != null ? Number(hoursStr) : def.defaultHours;
  if (Number.isNaN(hours) || hours < 1 || hours > 168) {
    return c.json({ error: 'hours must be between 1 and 168' }, 400);
  }

  // Substitute {arg} placeholder if present
  let queryString: string = def.query;
  if (arg != null) {
    queryString = queryString.replace(/\{arg\}/g, arg);
  }

  const client: CloudWatchLogsClient = getCwlClient();
  const now: number = Math.floor(Date.now() / 1000);
  const startTime: number = now - hours * 3600;

  try {
    // Start the query
    const startResult = await client.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime,
        endTime: now,
        queryString,
      }),
    );

    const queryId: string | undefined = startResult.queryId;
    if (queryId == null) {
      return c.json({ error: 'Failed to start CWL query' }, 500);
    }

    // Poll until complete
    let attempts: number = 0;
    while (attempts < MAX_POLL_ATTEMPTS) {
      const pollResult = await client.send(
        new GetQueryResultsCommand({ queryId }),
      );

      const status: string | undefined = pollResult.status;
      if (
        status === 'Complete' ||
        status === 'Failed' ||
        status === 'Cancelled'
      ) {
        if (status !== 'Complete') {
          return c.json({ error: `Query ${status.toLowerCase()}` }, 500);
        }

        // Extract columns and rows from results
        const rawResults: Array<Array<ResultField>> = pollResult.results ?? [];

        // Derive column names from results (excluding @ptr)
        const columnSet: Set<string> = new Set<string>();
        for (const row of rawResults) {
          for (const field of row) {
            if (field.field != null && field.field !== '@ptr') {
              columnSet.add(field.field);
            }
          }
        }
        const columns: Array<string> = [...columnSet];

        // Convert to row objects
        const data: Array<Record<string, string>> = rawResults.map(
          (row: Array<ResultField>) => {
            const obj: Record<string, string> = {};
            for (const field of row) {
              if (
                field.field != null &&
                field.field !== '@ptr' &&
                field.value != null
              ) {
                obj[field.field] = field.value;
              }
            }
            return obj;
          },
        );

        logger.info(
          { query: queryName, hours, rows: data.length },
          'CWL query complete',
        );

        return c.json({ data, columns, query: queryName, hours });
      }

      attempts++;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }

    return c.json({ error: 'Query timed out' }, 504);
  } catch (err: unknown) {
    const msg: string = err instanceof Error ? err.message : String(err);
    logger.error({ err, query: queryName }, 'CWL query failed');
    return c.json({ error: msg }, 500);
  }
});

export { logsRoutes };
