import { defineCommand } from 'citty';
import { DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { BedrockClient } from '../../inference/bedrock-client.ts';
import { InferenceService } from '../../inference/inference-service.ts';
import {
  DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  DEFAULT_SUMMARIZATION_USER_PROMPT,
  renderPrompt,
} from '../../inference/prompts.ts';
import { setConfigService } from '../../lib/config.ts';
import type { InferenceRequest, InferenceResponse } from '../../inference/types.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttachmentRow = {
  readonly attachmentKey: number;
  readonly fileNumber: string;
  readonly applicantName: string;
  readonly dateFiled: string;
  readonly appTypeCode: string;
  readonly subsystemCode: string;
  readonly textLength: number;
  readonly fullText: string;
};

// ---------------------------------------------------------------------------
// Minimal ConfigService shim for standalone CLI usage
// ---------------------------------------------------------------------------

class StandaloneConfig {
  private readonly values: Map<string, string>;

  constructor(entries: Record<string, string>) {
    this.values = new Map(Object.entries(entries));
  }

  get(key: string): string {
    return this.values.get(key) ?? '';
  }

  getAll(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

const FETCH_BATCH_SQL: string = `
  SELECT
    a.attachment_key,
    a.file_number,
    COALESCE(f.signer_name, '(unknown)') AS applicant_name,
    COALESCE(CAST(f.date_filed AS VARCHAR), '(unknown)') AS date_filed,
    COALESCE(f.app_type_code, '(unknown)') AS app_type_code,
    COALESCE(f.subsystem_code, '(unknown)') AS subsystem_code,
    a.text_length,
    a.full_text
  FROM attachment a
  JOIN filing f ON a.file_number = f.file_number
  WHERE a.full_text IS NOT NULL
    AND a.summary IS NULL
  ORDER BY a.text_length ASC
  LIMIT ?
`;

async function fetchBatch(
  conn: DuckDBConnection,
  batchSize: number,
): Promise<AttachmentRow[]> {
  const reader = await conn.runAndReadAll(FETCH_BATCH_SQL, [batchSize] as DuckDBValue[]);
  const rows: AttachmentRow[] = [];
  for (const row of reader.getRows()) {
    rows.push({
      attachmentKey: Number(row[0]),
      fileNumber: String(row[1]),
      applicantName: String(row[2]),
      dateFiled: String(row[3]),
      appTypeCode: String(row[4]),
      subsystemCode: String(row[5]),
      textLength: Number(row[6]),
      fullText: String(row[7]),
    });
  }
  return rows;
}

async function saveSummary(
  conn: DuckDBConnection,
  attachmentKey: number,
  summary: string,
): Promise<void> {
  await conn.run(
    `UPDATE attachment SET summary = $1 WHERE attachment_key = $2`,
    [summary, attachmentKey] as DuckDBValue[],
  );
}

async function countRemaining(conn: DuckDBConnection): Promise<number> {
  const reader = await conn.runAndReadAll(
    `SELECT COUNT(*) FROM attachment WHERE full_text IS NOT NULL AND summary IS NULL`,
  );
  return Number(reader.getRows()[0]![0]);
}

// ---------------------------------------------------------------------------
// Summarize one attachment
// ---------------------------------------------------------------------------

async function summarizeOne(
  service: InferenceService,
  modelId: string,
  systemPrompt: string,
  userPromptTemplate: string,
  row: AttachmentRow,
): Promise<InferenceResponse> {
  const vars: Record<string, string> = {
    fileNumber: row.fileNumber,
    applicantName: row.applicantName,
    dateFiled: row.dateFiled,
    appTypeCode: row.appTypeCode,
    subsystemCode: row.subsystemCode,
    fullText: row.fullText,
    attachmentName: '',
    companyName: '',
  };

  const request: InferenceRequest = {
    modelId,
    messages: [{ role: 'user', content: renderPrompt(userPromptTemplate, vars) }],
    params: {
      systemPrompt,
      maxTokens: 512,
      temperature: 0.3,
    },
  };
  return service.complete(request);
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function processWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex: number = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx: number = nextIndex++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export const summarizeCommand = defineCommand({
  meta: {
    name: 'summarize',
    description:
      'Summarize all attachments that have extracted text but no summary',
  },
  args: {
    database: databaseArg,
    region: {
      type: 'string',
      description: 'AWS region for Bedrock',
      default: 'us-east-2',
    },
    model: {
      type: 'string',
      description: 'Bedrock model ID for summarization',
      default: 'us.amazon.nova-pro-v1:0',
    },
    concurrency: {
      type: 'string',
      description: 'Number of concurrent Bedrock requests',
      default: '10',
    },
    batch: {
      type: 'string',
      description: 'Batch size — number of rows fetched per DB round-trip',
      default: '100',
    },
    limit: {
      type: 'string',
      description: 'Max total attachments to summarize (0 = unlimited)',
      default: '0',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Count remaining work without calling Bedrock',
      default: false,
    },
  },
  async run({ args }) {
    const concurrency: number = parseInt(args.concurrency, 10);
    const batchSize: number = parseInt(args.batch, 10);
    const maxLimit: number = parseInt(args.limit, 10);
    const modelId: string = args.model;
    const region: string = args.region;
    const dryRun: boolean = args['dry-run'] as boolean;

    // Bootstrap config shim — load prompt overrides from DB if available
    const shim = new StandaloneConfig({
      bedrockRegion: region,
      bedrockDefaultModel: modelId,
      summarizationModel: modelId,
    });
    setConfigService(shim as never);

    const client = new BedrockClient(region);
    const service = new InferenceService(client);

    // Resolve prompts: DB config value > built-in default
    // (In standalone CLI mode we use defaults; when run via the API server,
    //  ConfigService would have the admin-customized values.)
    const systemPrompt: string = DEFAULT_SUMMARIZATION_SYSTEM_PROMPT;
    const userPromptTemplate: string = DEFAULT_SUMMARIZATION_USER_PROMPT;

    const dbInstance = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(dbInstance);

    try {
      const remaining: number = await countRemaining(conn);
      const target: number = maxLimit > 0 ? Math.min(maxLimit, remaining) : remaining;

      console.log(`Attachments needing summary: ${String(remaining)}`);
      console.log(`Target: ${String(target)} | Model: ${modelId} | Concurrency: ${String(concurrency)}`);

      if (dryRun) {
        console.log('Dry run — exiting.');
        return;
      }

      if (target === 0) {
        console.log('Nothing to summarize.');
        return;
      }

      let processed: number = 0;
      let totalInputTokens: number = 0;
      let totalOutputTokens: number = 0;
      let totalLatencyMs: number = 0;
      let errors: number = 0;
      const startTime: number = performance.now();

      while (processed < target) {
        const fetchSize: number = Math.min(batchSize, target - processed);
        const rows: AttachmentRow[] = await fetchBatch(conn, fetchSize);
        if (rows.length === 0) break;

        const results = await processWithConcurrency(rows, concurrency, async (row) => {
          try {
            const resp: InferenceResponse = await summarizeOne(service, modelId, systemPrompt, userPromptTemplate, row);
            await saveSummary(conn, row.attachmentKey, resp.content);
            return { ok: true as const, resp };
          } catch (err: unknown) {
            const msg: string = err instanceof Error ? err.message : String(err);
            process.stderr.write(`\nERROR [${row.fileNumber}]: ${msg}\n`);
            return { ok: false as const };
          }
        });

        for (const r of results) {
          if (r.ok) {
            totalInputTokens += r.resp.usage.inputTokens;
            totalOutputTokens += r.resp.usage.outputTokens;
            totalLatencyMs += r.resp.latencyMs;
          } else {
            errors++;
          }
        }

        processed += rows.length;
        const elapsed: number = Math.round((performance.now() - startTime) / 1000);
        const rate: number = processed / elapsed;
        const eta: number = Math.round((target - processed) / rate);
        process.stdout.write(
          `\r  ${String(processed)} / ${String(target)} | ${rate.toFixed(1)} docs/s | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)} | errors: ${String(errors)}`,
        );
      }

      const wallSec: number = Math.round((performance.now() - startTime) / 1000);
      console.log('\n');
      console.log('=== Summarization Complete ===');
      console.log(`  Processed:      ${String(processed)}`);
      console.log(`  Errors:         ${String(errors)}`);
      console.log(`  Input tokens:   ${String(totalInputTokens)}`);
      console.log(`  Output tokens:  ${String(totalOutputTokens)}`);
      console.log(`  Wall time:      ${formatDuration(wallSec)}`);
      console.log(`  Avg latency:    ${String(Math.round(totalLatencyMs / (processed - errors)))} ms/doc`);
    } finally {
      conn.closeSync();
      dbInstance.closeSync();
    }
  },
});

function formatDuration(totalSeconds: number): string {
  const hrs: number = Math.floor(totalSeconds / 3600);
  const mins: number = Math.floor((totalSeconds % 3600) / 60);
  const secs: number = totalSeconds % 60;
  if (hrs > 0) return `${String(hrs)}h${String(mins).padStart(2, '0')}m`;
  if (mins > 0) return `${String(mins)}m${String(secs).padStart(2, '0')}s`;
  return `${String(secs)}s`;
}
