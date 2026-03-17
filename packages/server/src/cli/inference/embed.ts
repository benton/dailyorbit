import { defineCommand } from 'citty';
import { DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { BedrockClient } from '../../inference/bedrock-client.ts';
import { EmbeddingService } from '../../inference/embedding-service.ts';
import { ensureEmbeddingSchema } from '../../search/embedding-schema.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceTable = 'attachment' | 'filing' | 'pleading';

type SourceConfig = {
  readonly table: SourceTable;
  readonly keyColumn: string;
  readonly textColumn: string;
  readonly joinClause: string;
};

const SOURCE_CONFIGS: Record<SourceTable, SourceConfig> = {
  attachment: {
    table: 'attachment',
    keyColumn: 'attachment_key',
    textColumn: 'summary',
    joinClause: '',
  },
  filing: {
    table: 'filing',
    keyColumn: 'file_number',
    textColumn: 'description',
    joinClause: '',
  },
  pleading: {
    table: 'pleading',
    keyColumn: 'pleading_key',
    textColumn: 'exhibit_attachment_html',
    joinClause: '',
  },
};

type EmbeddableRow = {
  readonly sourceKey: string;
  readonly text: string;
};

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

async function fetchBatch(
  conn: DuckDBConnection,
  cfg: SourceConfig,
  batchSize: number,
): Promise<EmbeddableRow[]> {
  const sql: string = `
    SELECT CAST(t.${cfg.keyColumn} AS VARCHAR) AS source_key,
           t.${cfg.textColumn} AS text_content
    FROM ${cfg.table} t
    ${cfg.joinClause}
    WHERE t.${cfg.textColumn} IS NOT NULL
      AND CAST(t.${cfg.keyColumn} AS VARCHAR) NOT IN (
        SELECT e.source_key FROM embedding e WHERE e.source_table = ?
      )
    ORDER BY t.${cfg.keyColumn}
    LIMIT ?
  `;
  const reader = await conn.runAndReadAll(sql, [
    cfg.table,
    batchSize,
  ] as DuckDBValue[]);
  const rows: EmbeddableRow[] = [];
  for (const row of reader.getRows()) {
    rows.push({
      sourceKey: String(row[0]),
      text: String(row[1]),
    });
  }
  return rows;
}

async function saveEmbedding(
  conn: DuckDBConnection,
  sourceTable: string,
  sourceKey: string,
  embedding: number[],
  modelId: string,
): Promise<void> {
  await conn.run(
    `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id)
     VALUES (?, ?, 0, ?::FLOAT[512], ?)
     ON CONFLICT (source_table, source_key, chunk_index) DO UPDATE
       SET embedding = EXCLUDED.embedding,
           model_id = EXCLUDED.model_id,
           created_at = current_timestamp`,
    [sourceTable, sourceKey, JSON.stringify(embedding), modelId] as DuckDBValue[],
  );
}

async function updateAttribution(
  conn: DuckDBConnection,
  cfg: SourceConfig,
  sourceKey: string,
  modelId: string,
): Promise<void> {
  await conn.run(
    `UPDATE ${cfg.table}
       SET indexed_by = ?,
           indexed_at = current_timestamp
     WHERE CAST(${cfg.keyColumn} AS VARCHAR) = ?`,
    [modelId, sourceKey] as DuckDBValue[],
  );
}

async function countRemaining(
  conn: DuckDBConnection,
  cfg: SourceConfig,
): Promise<number> {
  const sql: string = `
    SELECT COUNT(*) FROM ${cfg.table} t
    WHERE t.${cfg.textColumn} IS NOT NULL
      AND CAST(t.${cfg.keyColumn} AS VARCHAR) NOT IN (
        SELECT e.source_key FROM embedding e WHERE e.source_table = ?
      )
  `;
  const reader = await conn.runAndReadAll(sql, [cfg.table] as DuckDBValue[]);
  return Number(reader.getRows()[0]![0]);
}

// ---------------------------------------------------------------------------
// Concurrency helper (same pattern as summarize.ts)
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

export const embedCommand = defineCommand({
  meta: {
    name: 'embed',
    description:
      'Generate vector embeddings for filing, attachment, and pleading text',
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
      description: 'Bedrock embedding model ID',
      default: 'amazon.titan-embed-text-v2:0',
    },
    dimensions: {
      type: 'string',
      description: 'Embedding vector dimensions',
      default: '512',
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
      description: 'Max total rows to embed (0 = unlimited)',
      default: '0',
    },
    source: {
      type: 'string',
      description:
        'Source table to embed: attachment, filing, pleading, or all',
      default: 'all',
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
    const dimensions: number = parseInt(args.dimensions, 10);
    const modelId: string = args.model;
    const region: string = args.region;
    const dryRun: boolean = args['dry-run'] as boolean;
    const sourceArg: string = args.source;

    const sources: SourceTable[] =
      sourceArg === 'all'
        ? ['filing', 'attachment', 'pleading']
        : [sourceArg as SourceTable];

    const dbInstance = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(dbInstance);

    try {
      // Ensure VSS extension and embedding table exist
      await ensureEmbeddingSchema(conn);

      for (const source of sources) {
        const cfg: SourceConfig = SOURCE_CONFIGS[source];
        console.log(`\n=== Embedding: ${source}.${cfg.textColumn} ===`);

        const remaining: number = await countRemaining(conn, cfg);
        const target: number =
          maxLimit > 0 ? Math.min(maxLimit, remaining) : remaining;

        console.log(`  Rows needing embeddings: ${String(remaining)}`);
        console.log(
          `  Target: ${String(target)} | Model: ${modelId} | Dims: ${String(dimensions)} | Concurrency: ${String(concurrency)}`,
        );

        if (source === 'attachment') {
          // Warn if most attachment summaries are NULL
          const nullCount = await conn.runAndReadAll(
            `SELECT COUNT(*) FROM attachment WHERE summary IS NULL AND full_text IS NOT NULL`,
          );
          const nullSummaries: number = Number(nullCount.getRows()[0]![0]);
          if (nullSummaries > remaining) {
            console.warn(
              `  ⚠ ${String(nullSummaries)} attachments have NULL summaries — run 'inference summarize' first`,
            );
          }
        }

        if (dryRun) {
          console.log('  Dry run — skipping.');
          continue;
        }

        if (target === 0) {
          console.log('  Nothing to embed.');
          continue;
        }

        const client = new BedrockClient(region);
        const service = new EmbeddingService(client);

        let processed: number = 0;
        let totalTokens: number = 0;
        let totalLatencyMs: number = 0;
        let errors: number = 0;
        const startTime: number = performance.now();

        while (processed < target) {
          const fetchSize: number = Math.min(batchSize, target - processed);
          const rows: EmbeddableRow[] = await fetchBatch(conn, cfg, fetchSize);
          if (rows.length === 0) break;

          const results = await processWithConcurrency(
            rows,
            concurrency,
            async (row: EmbeddableRow) => {
              try {
                const resp = await service.embedQuery(
                  row.text,
                  modelId,
                  dimensions,
                  true,
                );
                await saveEmbedding(
                  conn,
                  source,
                  row.sourceKey,
                  resp.embedding,
                  modelId,
                );
                await updateAttribution(conn, cfg, row.sourceKey, modelId);
                return { ok: true as const, tokens: resp.inputTokenCount, latencyMs: resp.latencyMs };
              } catch (err: unknown) {
                const msg: string =
                  err instanceof Error ? err.message : String(err);
                process.stderr.write(
                  `\n  ERROR [${source}:${row.sourceKey}]: ${msg}\n`,
                );
                return { ok: false as const, tokens: 0, latencyMs: 0 };
              }
            },
          );

          for (const r of results) {
            if (r.ok) {
              totalTokens += r.tokens;
              totalLatencyMs += r.latencyMs;
            } else {
              errors++;
            }
          }

          processed += rows.length;
          const elapsed: number = Math.round(
            (performance.now() - startTime) / 1000,
          );
          const rate: number = elapsed > 0 ? processed / elapsed : processed;
          const eta: number =
            rate > 0 ? Math.round((target - processed) / rate) : 0;
          process.stdout.write(
            `\r  ${String(processed)} / ${String(target)} | ${rate.toFixed(1)} rows/s | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)} | errors: ${String(errors)}`,
          );
        }

        const wallSec: number = Math.round(
          (performance.now() - startTime) / 1000,
        );
        console.log(`\n  Done: ${String(processed)} rows, ${String(totalTokens)} tokens, ${formatDuration(wallSec)}, ${String(errors)} errors`);
      }
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
