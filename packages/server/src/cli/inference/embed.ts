import { defineCommand } from 'citty';
import { DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { BedrockClient } from '../../inference/bedrock-client.ts';
import { EmbeddingService } from '../../inference/embedding-service.ts';
import type { EmbeddingResponse } from '../../inference/types.ts';
import {
  splitText,
  embedChunk,
  EMBEDDING_MAX_CHARS,
  EMBEDDING_OVERLAP,
} from '../../inference/text-chunker.ts';
import { processWithConcurrency } from '../../lib/concurrency.ts';
import { computeTextChecksum } from '../../lib/text-utils.ts';
import { ensureEmbeddingSchema } from '../../search/embedding-schema.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceTable = 'attachment' | 'filing' | 'pleading' | 'news_item';

type SourceConfig = {
  readonly table: SourceTable;
  readonly keyColumn: string;
  readonly textColumn: string;
  readonly joinClause: string;
  readonly sortExpr: string;
};

const SOURCE_CONFIGS: Record<SourceTable, SourceConfig> = {
  attachment: {
    table: 'attachment',
    keyColumn: 'attachment_key',
    textColumn: 'full_text',
    joinClause: 'LEFT JOIN filing f ON t.file_number = f.file_number',
    sortExpr: "COALESCE(f.date_filed, DATE '1970-01-01')",
  },
  filing: {
    table: 'filing',
    keyColumn: 'file_number',
    textColumn: 'description',
    joinClause: '',
    sortExpr: "COALESCE(t.date_filed, DATE '1970-01-01')",
  },
  pleading: {
    table: 'pleading',
    keyColumn: 'pleading_key',
    textColumn: 'exhibit_attachment_html',
    joinClause: 'LEFT JOIN filing f ON t.filing_key = f.filing_key',
    sortExpr: "COALESCE(f.date_filed, DATE '1970-01-01')",
  },
  news_item: {
    table: 'news_item',
    keyColumn: 'id',
    textColumn: 'full_text',
    joinClause: '',
    sortExpr: "COALESCE(t.published_at, DATE '1970-01-01')",
  },
};

type EmbeddableRow = {
  readonly sourceKey: string;
  readonly text: string;
  readonly textChecksum: string;
};

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/**
 * Fetch a batch of rows that need (re-)embedding. A row needs embedding if:
 * - No embedding rows exist for it, OR
 * - The existing embedding's text_checksum differs from the source text checksum
 */
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
      AND LENGTH(TRIM(t.${cfg.textColumn})) > 0
      AND NOT EXISTS (
        SELECT 1 FROM embedding e
        WHERE e.source_table = ?
          AND e.source_key = CAST(t.${cfg.keyColumn} AS VARCHAR)
          AND e.chunk_index = 0
          AND e.text_checksum IS NOT NULL
          AND e.text_checksum = md5(t.${cfg.textColumn})
      )
    GROUP BY t.${cfg.keyColumn}, t.${cfg.textColumn}
    ORDER BY MAX(${cfg.sortExpr}) DESC, t.${cfg.keyColumn}
    LIMIT ?
  `;
  const reader = await conn.runAndReadAll(sql, [
    cfg.table,
    batchSize,
  ] as DuckDBValue[]);
  const rows: EmbeddableRow[] = [];
  for (const row of reader.getRows()) {
    const text: string = String(row[1]);
    rows.push({
      sourceKey: String(row[0]),
      text,
      textChecksum: computeTextChecksum(text),
    });
  }
  return rows;
}

async function deleteExistingChunks(
  conn: DuckDBConnection,
  sourceTable: string,
  sourceKey: string,
): Promise<void> {
  await conn.run(
    `DELETE FROM embedding WHERE source_table = ? AND source_key = ?`,
    [sourceTable, sourceKey] as DuckDBValue[],
  );
}

async function saveEmbedding(
  conn: DuckDBConnection,
  sourceTable: string,
  sourceKey: string,
  chunkIndex: number,
  embedding: number[],
  modelId: string,
  textChecksum: string,
): Promise<void> {
  await conn.run(
    `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id, text_checksum)
     VALUES (?, ?, ?, ?::FLOAT[512], ?, ?)`,
    [
      sourceTable,
      sourceKey,
      chunkIndex,
      JSON.stringify(embedding),
      modelId,
      textChecksum,
    ] as DuckDBValue[],
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
      AND LENGTH(TRIM(t.${cfg.textColumn})) > 0
      AND NOT EXISTS (
        SELECT 1 FROM embedding e
        WHERE e.source_table = ?
          AND e.source_key = CAST(t.${cfg.keyColumn} AS VARCHAR)
          AND e.chunk_index = 0
          AND e.text_checksum IS NOT NULL
          AND e.text_checksum = md5(t.${cfg.textColumn})
      )
  `;
  const reader = await conn.runAndReadAll(sql, [cfg.table] as DuckDBValue[]);
  return Number(reader.getRows()[0]![0]);
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
        'Source table to embed: attachment, filing, pleading, news_item, or all',
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
        ? ['filing', 'attachment', 'pleading', 'news_item']
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
        console.log(
          `  Chunk size: ${String(EMBEDDING_MAX_CHARS)} chars | Overlap: ${String(EMBEDDING_OVERLAP)} chars`,
        );

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
        let totalChunks: number = 0;
        let totalTokens: number = 0;
        let totalLatencyMs: number = 0;
        let errors: number = 0;
        const failedKeys: Set<string> = new Set();
        const startTime: number = performance.now();

        while (processed < target) {
          const fetchSize: number = Math.min(batchSize, target - processed);
          const rows: EmbeddableRow[] = (
            await fetchBatch(conn, cfg, fetchSize + failedKeys.size)
          )
            .filter((r: EmbeddableRow) => !failedKeys.has(r.sourceKey))
            .slice(0, fetchSize);
          if (rows.length === 0) break;

          const results = await processWithConcurrency(
            rows,
            concurrency,
            async (row: EmbeddableRow) => {
              try {
                const chunks: string[] = splitText(
                  row.text,
                  EMBEDDING_MAX_CHARS,
                  EMBEDDING_OVERLAP,
                );

                let rowTokens: number = 0;
                let rowLatencyMs: number = 0;

                // Delete any existing embeddings before inserting new chunks
                await deleteExistingChunks(conn, source, row.sourceKey);

                for (let ci = 0; ci < chunks.length; ci++) {
                  const resp: EmbeddingResponse = await embedChunk(
                    service,
                    chunks[ci]!,
                    modelId,
                    dimensions,
                  );
                  await saveEmbedding(
                    conn,
                    source,
                    row.sourceKey,
                    ci,
                    resp.embedding,
                    modelId,
                    row.textChecksum,
                  );
                  rowTokens += resp.inputTokenCount;
                  rowLatencyMs += resp.latencyMs;
                }

                await updateAttribution(conn, cfg, row.sourceKey, modelId);
                return {
                  ok: true as const,
                  tokens: rowTokens,
                  latencyMs: rowLatencyMs,
                  chunks: chunks.length,
                };
              } catch (err: unknown) {
                const msg: string =
                  err instanceof Error ? err.message : String(err);
                process.stderr.write(
                  `\n  ERROR [${source}:${row.sourceKey}]: ${msg}\n`,
                );
                failedKeys.add(row.sourceKey);
                return {
                  ok: false as const,
                  tokens: 0,
                  latencyMs: 0,
                  chunks: 0,
                };
              }
            },
          );

          for (const r of results) {
            if (r.ok) {
              totalTokens += r.tokens;
              totalLatencyMs += r.latencyMs;
              totalChunks += r.chunks;
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
            `\r  ${String(processed)} / ${String(target)} | ${rate.toFixed(1)} rows/s | ${String(totalChunks)} chunks | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)} | errors: ${String(errors)}`,
          );
        }

        const wallSec: number = Math.round(
          (performance.now() - startTime) / 1000,
        );
        console.log(
          `\n  Done: ${String(processed)} rows, ${String(totalChunks)} chunks, ${String(totalTokens)} tokens, ${formatDuration(wallSec)}, avg latency ${processed > 0 ? String(Math.round(totalLatencyMs / processed)) : '0'}ms, ${String(errors)} errors`,
        );
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
