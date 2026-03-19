/**
 * Pipeline stage registry — maps stage IDs to their service functions.
 *
 * Each stage wraps an existing service function behind a uniform
 * (PipelineContext) => Promise<StageResult> interface so the runner
 * can execute them generically.
 */

import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

// ── Public types ────────────────────────────────────────────────────

export type StageResult = {
  itemsProcessed: number;
  itemsFailed: number;
  durationMs: number;
  summary?: string;
};

export type PipelineContext = {
  db: DuckDBInstance;
  conn: DuckDBConnection;
  concurrency: number;
  log: (level: 'info' | 'error' | 'progress', message: string) => void;
  onProgress: (processed: number, total: number) => void;
};

export type PipelineGroup = {
  id: string;
  name: string;
  stageIds: string[];
};

export type PipelineStage = {
  id: string;
  group: string;
  name: string;
  description: string;
  /** Default concurrency for this stage (undefined = not applicable). */
  defaultConcurrency?: number | undefined;
  run: (ctx: PipelineContext) => Promise<StageResult>;
};

// ── Stage definitions ───────────────────────────────────────────────

const STAGES: PipelineStage[] = [
  // ── Filing Ingest ───────────────────────────────────────────────
  {
    id: 'ingest.icfs',
    group: 'ingest',
    name: 'ICFS Ingest',
    description: 'Discover and ingest filings from the new ICFS API',
    defaultConcurrency: 1,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runIcfsIngest } = await import('../icfs/pipeline.ts');
      const start: number = Date.now();
      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const dateFrom: string = `${String(oneMonthAgo.getFullYear())}-${String(oneMonthAgo.getMonth() + 1).padStart(2, '0')}`;
      const dateTo: string = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      ctx.log(
        'info',
        `ICFS ingest: ${dateFrom} to ${dateTo} (concurrency=${String(ctx.concurrency)})`,
      );
      const result = await runIcfsIngest({
        dbInstance: ctx.db,
        dateFrom,
        dateTo,
        concurrency: ctx.concurrency,
        onProgress: (msg: string) => ctx.log('progress', msg),
      });
      return {
        itemsProcessed: result.filingsIngested,
        itemsFailed: result.filingsFailed,
        durationMs: Date.now() - start,
        summary: `Discovered ${String(result.filingsDiscovered)}, ingested ${String(result.filingsIngested)}`,
      };
    },
  },

  // ── Attachments ─────────────────────────────────────────────────
  {
    id: 'attachments.discover-download',
    group: 'attachments',
    name: 'Discover & Download',
    description: 'Discover attachment metadata and download files',
    defaultConcurrency: 5,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runAttachmentPipeline } =
        await import('../attachments/pipeline.ts');
      const start: number = Date.now();
      const result = await runAttachmentPipeline({
        dbInstance: ctx.db,
        storageBasePath: 'data/attachments',
        scope: {},
        concurrency: ctx.concurrency,
        onProgress: (msg: string) => ctx.log('progress', msg),
      });
      return {
        itemsProcessed:
          result.attachmentsDiscovered + result.attachmentsDownloaded,
        itemsFailed: result.attachmentsFailed,
        durationMs: Date.now() - start,
        summary: `Discovered ${String(result.attachmentsDiscovered)}, downloaded ${String(result.attachmentsDownloaded)}`,
      };
    },
  },
  {
    id: 'attachments.extract',
    group: 'attachments',
    name: 'Extract Text',
    description: 'Extract text content from downloaded PDF/HTML attachments',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runExtractionPipeline } =
        await import('../attachments/extract-pipeline.ts');
      const start: number = Date.now();
      const result = await runExtractionPipeline({
        dbInstance: ctx.db,
        onProgress: (msg: string) => ctx.log('progress', msg),
      });
      return {
        itemsProcessed: result.extracted,
        itemsFailed: result.failed,
        durationMs: Date.now() - start,
        summary: `Extracted ${String(result.extracted)}, skipped ${String(result.skippedNoText + result.skippedNotPdf)}`,
      };
    },
  },
  {
    id: 'attachments.validate',
    group: 'attachments',
    name: 'Validate Content Types',
    description:
      'Verify content types of downloaded attachments via magic bytes',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runValidationPipeline } =
        await import('../attachments/validate-pipeline.ts');
      const start: number = Date.now();
      const result = await runValidationPipeline({
        dbInstance: ctx.db,
        onProgress: (msg: string) => ctx.log('progress', msg),
      });
      return {
        itemsProcessed: result.corrected + result.confirmed,
        itemsFailed: result.failed,
        durationMs: Date.now() - start,
        summary: `Confirmed ${String(result.confirmed)}, corrected ${String(result.corrected)}`,
      };
    },
  },
  {
    id: 'attachments.summarize',
    group: 'attachments',
    name: 'Summarize Attachments',
    description: 'Generate LLM summaries of extracted attachment text',
    defaultConcurrency: 10,
    async run(ctx: PipelineContext): Promise<StageResult> {
      // This stage mirrors the CLI summarize command logic inline
      // because there's no single pipeline function for it
      const { DuckDBConnection } = await import('@duckdb/node-api');
      const {
        getPendingSummarizations,
        findExistingSummaryByChecksum,
        saveSummary,
      } = await import('../attachments/repository.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const {
        DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
        DEFAULT_SUMMARIZATION_USER_PROMPT,
        renderPrompt,
      } = await import('../inference/prompts.ts');

      const start: number = Date.now();
      const conn: DuckDBConnection = await DuckDBConnection.create(ctx.db);
      try {
        const rows = await getPendingSummarizations(conn, {});
        if (rows.length === 0) {
          ctx.log('info', 'No attachments pending summarization');
          return {
            itemsProcessed: 0,
            itemsFailed: 0,
            durationMs: Date.now() - start,
          };
        }

        const region: string = process.env.AWS_REGION ?? 'us-east-2';
        const modelId: string = 'us.amazon.nova-pro-v1:0';
        const client = new BedrockClient(region);
        const service = new InferenceService(client);
        let processed: number = 0;
        let failed: number = 0;

        for (const row of rows) {
          try {
            // Dedup check
            if (row.textChecksum != null) {
              const existing = await findExistingSummaryByChecksum(
                conn,
                row.textChecksum,
              );
              if (existing != null) {
                await saveSummary(conn, row.attachmentKey, existing, 'copied');
                processed++;
                continue;
              }
            }

            const vars: Record<string, string> = {
              fileNumber: row.fileNumber,
              applicantName: row.applicantName,
              dateFiled: row.dateFiled,
              appTypeCode: row.appTypeCode,
              subsystemCode: row.subsystemCode,
              fullText: row.fullText.slice(0, 60000),
              attachmentName: row.attachmentName,
              companyName: '',
            };
            const resp = await service.complete({
              modelId,
              messages: [
                {
                  role: 'user',
                  content: renderPrompt(
                    DEFAULT_SUMMARIZATION_USER_PROMPT,
                    vars,
                  ),
                },
              ],
              params: {
                systemPrompt: DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
                maxTokens: 512,
                temperature: 0.3,
              },
            });
            await saveSummary(conn, row.attachmentKey, resp.content, modelId);
            processed++;
            ctx.onProgress(processed, rows.length);
          } catch (err: unknown) {
            failed++;
            ctx.log(
              'error',
              `Failed to summarize attachment ${String(row.attachmentKey)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return {
          itemsProcessed: processed,
          itemsFailed: failed,
          durationMs: Date.now() - start,
          summary: `Summarized ${String(processed)} attachments`,
        };
      } finally {
        conn.closeSync();
      }
    },
  },
  {
    id: 'attachments.embed',
    group: 'attachments',
    name: 'Embed Attachments',
    description: 'Generate vector embeddings for attachment text',
    defaultConcurrency: 10,
    async run(ctx: PipelineContext): Promise<StageResult> {
      // Mirrors the CLI embed command for source=attachment
      const { DuckDBConnection } = await import('@duckdb/node-api');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const { EmbeddingService } =
        await import('../inference/embedding-service.ts');
      const { ensureEmbeddingSchema } =
        await import('../search/embedding-schema.ts');
      const { splitText } = await import('../inference/text-chunker.ts');
      const { computeTextChecksum } = await import('../lib/text-utils.ts');

      const start: number = Date.now();
      const conn: DuckDBConnection = await DuckDBConnection.create(ctx.db);
      try {
        await ensureEmbeddingSchema(conn);
        const modelId: string = 'amazon.titan-embed-text-v2:0';
        const dimensions: number = 512;
        const region: string = process.env.AWS_REGION ?? 'us-east-2';
        const client = new BedrockClient(region);
        const service = new EmbeddingService(client);

        // Find attachments needing embeddings
        const sql: string = `
          SELECT CAST(a.attachment_key AS VARCHAR) AS source_key, a.full_text
          FROM attachment a
          WHERE a.full_text IS NOT NULL AND LENGTH(TRIM(a.full_text)) > 0
            AND NOT EXISTS (
              SELECT 1 FROM embedding e
              WHERE e.source_table = 'attachment'
                AND e.source_key = CAST(a.attachment_key AS VARCHAR)
                AND e.chunk_index = 0
            )
          `;
        const reader = await conn.runAndReadAll(sql);
        const rows = reader.getRowObjectsJS();

        if (rows.length === 0) {
          ctx.log('info', 'No attachments pending embedding');
          return {
            itemsProcessed: 0,
            itemsFailed: 0,
            durationMs: Date.now() - start,
          };
        }

        let processed: number = 0;
        let failed: number = 0;

        for (const row of rows) {
          try {
            const text: string = String(row.full_text);
            const sourceKey: string = String(row.source_key);
            const textChecksum: string = computeTextChecksum(text);
            const chunks: string[] = splitText(text, 20000, 500);

            // Delete existing embeddings
            await conn.run(
              `DELETE FROM embedding WHERE source_table = 'attachment' AND source_key = ?`,
              [sourceKey] as import('@duckdb/node-api').DuckDBValue[],
            );

            for (let ci: number = 0; ci < chunks.length; ci++) {
              const resp = await service.embedQuery(
                chunks[ci]!,
                modelId,
                dimensions,
                true,
              );
              await conn.run(
                `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id, text_checksum)
                 VALUES (?, ?, ?, ?::FLOAT[512], ?, ?)`,
                [
                  'attachment',
                  sourceKey,
                  ci,
                  JSON.stringify(resp.embedding),
                  modelId,
                  textChecksum,
                ] as import('@duckdb/node-api').DuckDBValue[],
              );
            }

            await conn.run(
              `UPDATE attachment SET indexed_by = ?, indexed_at = current_timestamp WHERE CAST(attachment_key AS VARCHAR) = ?`,
              [modelId, sourceKey] as import('@duckdb/node-api').DuckDBValue[],
            );
            processed++;
            ctx.onProgress(processed, rows.length);
          } catch (err: unknown) {
            failed++;
            ctx.log(
              'error',
              `Embed failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return {
          itemsProcessed: processed,
          itemsFailed: failed,
          durationMs: Date.now() - start,
          summary: `Embedded ${String(processed)} attachments`,
        };
      } finally {
        conn.closeSync();
      }
    },
  },

  // ── Companies ───────────────────────────────────────────────────
  {
    id: 'companies.seed',
    group: 'companies',
    name: 'Seed Companies',
    description: 'Load built-in satellite industry company dataset',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureCompanyTables, ensureCompanyFk } =
        await import('../companies/schema.ts');
      const { seedCompanies } = await import('../companies/attribution.ts');
      const { COMPANY_SEED_DATA } = await import('../companies/seed-data.ts');
      const start: number = Date.now();
      await ensureCompanyTables(ctx.conn);
      await ensureCompanyFk(ctx.conn);
      const result = await seedCompanies(ctx.conn, COMPANY_SEED_DATA);
      return {
        itemsProcessed: result.created + result.aliasesAdded,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: `Created ${String(result.created)} companies, ${String(result.aliasesAdded)} aliases`,
      };
    },
  },
  {
    id: 'companies.attribute',
    group: 'companies',
    name: 'Attribute Filings',
    description: 'Match unattributed filings to company entities',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureCompanyTables, ensureCompanyFk } =
        await import('../companies/schema.ts');
      const { runBatchAttribution } =
        await import('../companies/attribution.ts');
      const start: number = Date.now();
      await ensureCompanyTables(ctx.conn);
      await ensureCompanyFk(ctx.conn);
      const result = await runBatchAttribution(
        ctx.conn,
        (processed: number, total: number) => ctx.onProgress(processed, total),
      );
      return {
        itemsProcessed: result.attributed,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: `Attributed ${String(result.attributed)}, skipped ${String(result.skipped)}`,
      };
    },
  },
  {
    id: 'companies.extract-ownership',
    group: 'companies',
    name: 'Extract Ownership',
    description: 'Derive ownership events from T/C and ASG filings',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureCompanyTables, ensureCompanyFk } =
        await import('../companies/schema.ts');
      const { extractOwnershipEvents } =
        await import('../companies/repository.ts');
      const start: number = Date.now();
      await ensureCompanyTables(ctx.conn);
      await ensureCompanyFk(ctx.conn);
      const result = await extractOwnershipEvents(
        ctx.conn,
        (processed: number, total: number) => ctx.onProgress(processed, total),
      );
      return {
        itemsProcessed: result.created,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: `Created ${String(result.created)} events, skipped ${String(result.skipped)}`,
      };
    },
  },
  {
    id: 'companies.enrich',
    group: 'companies',
    name: 'Enrich Companies',
    description: 'Enrich company data from GLEIF and Wikidata',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { enrichAllCompanies } = await import('../enrichment/pipeline.ts');
      const start: number = Date.now();
      const result = await enrichAllCompanies(
        ctx.conn,
        (processed: number, total: number) => ctx.onProgress(processed, total),
      );
      return {
        itemsProcessed: result.enriched,
        itemsFailed: result.errors,
        durationMs: Date.now() - start,
        summary: `Enriched ${String(result.enriched)}, skipped ${String(result.skipped)}`,
      };
    },
  },

  // ── News ────────────────────────────────────────────────────────
  {
    id: 'news.seed',
    group: 'news',
    name: 'Seed Sources',
    description: 'Load default RSS feed sources',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { seedNewsSources } = await import('../news/repository.ts');
      const { NEWS_SOURCE_SEED_DATA } = await import('../news/seed-data.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);
      const result = await seedNewsSources(ctx.conn, NEWS_SOURCE_SEED_DATA);
      return {
        itemsProcessed: result.created,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: `Created ${String(result.created)}, skipped ${String(result.skipped)}`,
      };
    },
  },
  {
    id: 'news.fetch',
    group: 'news',
    name: 'Fetch Feeds',
    description: 'Poll RSS feeds for new articles',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { fetchAllDueSources } = await import('../news/rss-fetcher.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);
      const { results, totalInserted } = await fetchAllDueSources(
        ctx.conn,
        (result) => {
          if (result.error != null) {
            ctx.log('error', `${result.sourceName}: ${result.error}`);
          } else {
            ctx.log(
              'info',
              `${result.sourceName}: ${String(result.itemsInserted)} new, ${String(result.itemsSkipped)} skipped`,
            );
          }
        },
      );
      const errors: number = results.filter((r) => r.error != null).length;
      return {
        itemsProcessed: totalInserted,
        itemsFailed: errors,
        durationMs: Date.now() - start,
        summary: `${String(results.length)} sources, ${String(totalInserted)} new items`,
      };
    },
  },
  {
    id: 'news.extract',
    group: 'news',
    name: 'Extract Articles',
    description: 'Download and extract full text from article URLs',
    defaultConcurrency: 3,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { extractArticles } = await import('../news/article-extractor.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);
      const result = await extractArticles(ctx.conn, 100, ctx.concurrency);
      return {
        itemsProcessed: result.extracted,
        itemsFailed: result.failed,
        durationMs: Date.now() - start,
        summary: `Extracted ${String(result.extracted)}, failed ${String(result.failed)}`,
      };
    },
  },
  {
    id: 'news.summarize',
    group: 'news',
    name: 'Summarize News',
    description: 'Generate LLM summaries of extracted articles',
    defaultConcurrency: 5,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { summarizeNewsItems } = await import('../news/summarize-news.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);

      // Count pending before and after to derive processed count
      const countSql: string =
        'SELECT COUNT(*) AS cnt FROM news_item WHERE full_text IS NOT NULL AND summary IS NULL';
      const beforeReader = await ctx.conn.runAndReadAll(countSql);
      const pendingBefore: number = Number(
        beforeReader.getRowObjectsJS()[0]!.cnt,
      );
      ctx.log(
        'info',
        `${String(pendingBefore)} articles pending summarization`,
      );

      await summarizeNewsItems(ctx.conn, {
        region: process.env.AWS_REGION ?? 'us-east-2',
        modelId: 'us.amazon.nova-pro-v1:0',
        concurrency: ctx.concurrency,
        limit: 0,
        dryRun: false,
      });

      const afterReader = await ctx.conn.runAndReadAll(countSql);
      const pendingAfter: number = Number(
        afterReader.getRowObjectsJS()[0]!.cnt,
      );
      const processed: number = pendingBefore - pendingAfter;
      return {
        itemsProcessed: processed,
        itemsFailed: pendingAfter,
        durationMs: Date.now() - start,
        summary: `Summarized ${String(processed)} articles`,
      };
    },
  },
  {
    id: 'news.attribute',
    group: 'news',
    name: 'Attribute News',
    description: 'Match news items to company entities',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { ensureCompanyTables } = await import('../companies/schema.ts');
      const { attributeNewsItems } = await import('../news/attribute-news.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);
      await ensureCompanyTables(ctx.conn);
      const result = await attributeNewsItems(ctx.conn, 500);
      return {
        itemsProcessed: result.attributed,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: `Attributed ${String(result.attributed)}, skipped ${String(result.skipped)}`,
      };
    },
  },

  // ── Search ──────────────────────────────────────────────────────
  {
    id: 'search.rebuild-index',
    group: 'search',
    name: 'Rebuild FTS Index',
    description: 'Rebuild all full-text search indexes',
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { rebuildAllFtsIndexes } = await import('../search/fts-index.ts');
      const start: number = Date.now();
      ctx.log('info', 'Rebuilding FTS indexes...');
      await rebuildAllFtsIndexes(ctx.conn);
      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: 'FTS indexes rebuilt',
      };
    },
  },
];

// ── Groups ──────────────────────────────────────────────────────────

export const PIPELINE_GROUPS: PipelineGroup[] = [
  { id: 'ingest', name: 'Filing Ingest', stageIds: ['ingest.icfs'] },
  {
    id: 'attachments',
    name: 'Attachments',
    stageIds: [
      'attachments.discover-download',
      'attachments.extract',
      'attachments.validate',
      'attachments.summarize',
      'attachments.embed',
    ],
  },
  {
    id: 'companies',
    name: 'Companies',
    stageIds: [
      'companies.seed',
      'companies.attribute',
      'companies.extract-ownership',
      'companies.enrich',
    ],
  },
  {
    id: 'news',
    name: 'News',
    stageIds: [
      'news.seed',
      'news.fetch',
      'news.extract',
      'news.summarize',
      'news.attribute',
    ],
  },
  { id: 'search', name: 'Search', stageIds: ['search.rebuild-index'] },
];

// ── Lookup helpers ──────────────────────────────────────────────────

const stageMap: Map<string, PipelineStage> = new Map(
  STAGES.map((s: PipelineStage) => [s.id, s]),
);

export function getStage(id: string): PipelineStage | undefined {
  return stageMap.get(id);
}

export function getAllStages(): PipelineStage[] {
  return STAGES;
}

export function getStagesByGroup(groupId: string): PipelineStage[] {
  return STAGES.filter((s: PipelineStage) => s.group === groupId);
}
