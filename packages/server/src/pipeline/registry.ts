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
  itemsDiscovered?: number;
  itemsProcessed: number;
  itemsSkipped?: number;
  itemsFailed: number;
  durationMs: number;
  summary?: string;
};

export type PipelineContext = {
  db: DuckDBInstance;
  conn: DuckDBConnection;
  concurrency: number;
  signal: AbortSignal;
  mode: 'probe' | 'full';
  pipelineRunId: number;
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
  /** Default concurrency for this stage (1 = sequential). */
  defaultConcurrency: number;
  /** Whether this stage supports concurrency > 1. Controls UI input visibility. */
  parallelizable: boolean;
  /** Whether this stage supports resetting failed matches. */
  resettable?: boolean;
  run: (ctx: PipelineContext) => Promise<StageResult>;
};

// ── Alert stage factory ─────────────────────────────────────────────

type AlertSearchType = 'metadata' | 'keyword' | 'semantic';

const ALERT_STAGE_DEFS: Array<{
  id: string;
  name: string;
  searchType: AlertSearchType;
  description: string;
}> = [
  {
    id: 'alerts.evaluate-metadata',
    name: 'Evaluate Metadata Alerts',
    searchType: 'metadata',
    description:
      'Evaluate metadata-only saved searches (applicant, subsystem, file number)',
  },
  {
    id: 'alerts.evaluate-semantic',
    name: 'Evaluate Semantic Alerts',
    searchType: 'semantic',
    description: 'Evaluate semantic/vector similarity saved searches',
  },
  {
    id: 'alerts.evaluate-keyword',
    name: 'Evaluate Keyword Alerts',
    searchType: 'keyword',
    description: 'Evaluate keyword/FTS-based saved searches',
  },
];

function makeAlertStage(searchType: AlertSearchType): PipelineStage {
  const def = ALERT_STAGE_DEFS.find((d) => d.searchType === searchType)!;
  return {
    id: def.id,
    group: 'alerts',
    name: def.name,
    description: def.description,
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureAlertTables } = await import('../alerts/schema.ts');
      const { evaluateAlertsWithEmail } =
        await import('../alerts/evaluator.ts');
      const { ensureSavedSearchTables } =
        await import('../saved-search/schema.ts');
      const { ensureContentFlagTables } =
        await import('../content-flag/schema.ts');
      const { ensureViewingHistoryTables } =
        await import('../viewing-history/schema.ts');
      const { createEmailService } = await import('../email/email-service.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const start: number = Date.now();

      await ensureAlertTables(ctx.conn);
      await ensureSavedSearchTables(ctx.conn);
      await ensureContentFlagTables(ctx.conn);
      await ensureViewingHistoryTables(ctx.conn);

      const config = getConfigService();
      const emailService = createEmailService({
        transport: String(config.get('emailTransport')) as
          | 'ses'
          | 'smtp'
          | 'test',
        region: String(config.get('emailRegion')),
        senderAddress: String(config.get('emailSenderAddress')),
      });
      const baseUrl: string = String(config.get('appBaseUrl'));

      const result = await evaluateAlertsWithEmail(
        ctx.conn,
        ctx.pipelineRunId,
        emailService,
        baseUrl,
        def.searchType,
      );

      ctx.log(
        'info',
        `[${def.searchType}] Evaluated ${String(result.searchesEvaluated)} searches: ${String(result.totalMatched)} matched, ${String(result.totalFlagged)} flagged, ${String(result.emailsSent)} emails sent`,
      );

      return {
        itemsDiscovered: result.totalMatched,
        itemsProcessed: result.searchesEvaluated,
        itemsFailed: result.errors,
        durationMs: Date.now() - start,
        summary: `${String(result.searchesEvaluated)} ${def.searchType} searches, ${String(result.totalMatched)} matches, ${String(result.totalFlagged)} flagged`,
      };
    },
  };
}

// ── Stage definitions ───────────────────────────────────────────────

const STAGES: PipelineStage[] = [
  // ── Filing Ingest ───────────────────────────────────────────────
  {
    id: 'ingest.icfs',
    group: 'ingest',
    name: 'ICFS Ingest',
    description: 'Discover and ingest filings from the new ICFS API',
    defaultConcurrency: 20,
    parallelizable: true,
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
        skipKnown: ctx.mode === 'probe',
        pipelineRunId: ctx.pipelineRunId,
        onProgress: (msg: string) => ctx.log('progress', msg),
      });
      return {
        itemsDiscovered: result.filingsDiscovered,
        itemsProcessed: result.filingsIngested,
        itemsSkipped: result.skippedKnown,
        itemsFailed: result.filingsFailed,
        durationMs: Date.now() - start,
        summary: `Discovered ${String(result.filingsDiscovered)}, ingested ${String(result.filingsIngested)}, skipped ${String(result.skippedKnown)}`,
      };
    },
  },

  // ── Alerts: metadata (after ingest.icfs) ────────────────────────
  makeAlertStage('metadata'),

  // ── Attachments ─────────────────────────────────────────────────
  {
    id: 'attachments.discover-download',
    group: 'attachments',
    name: 'Discover & Download',
    description: 'Discover attachment metadata and download files',
    defaultConcurrency: 20,
    parallelizable: true,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runAttachmentPipeline } =
        await import('../attachments/pipeline.ts');
      const start: number = Date.now();
      const result = await runAttachmentPipeline({
        dbInstance: ctx.db,
        storageBasePath: 'data/attachments',
        scope: {},
        concurrency: ctx.concurrency,
        signal: ctx.signal,
        stopAfterDownload: true,
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
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runExtractionPipeline } =
        await import('../attachments/extract-pipeline.ts');
      const start: number = Date.now();
      const result = await runExtractionPipeline({
        dbInstance: ctx.db,
        concurrency: ctx.concurrency,
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
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { runValidationPipeline } =
        await import('../attachments/validate-pipeline.ts');
      const start: number = Date.now();
      const result = await runValidationPipeline({
        dbInstance: ctx.db,
        concurrency: ctx.concurrency,
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
    defaultConcurrency: 15,
    parallelizable: true,
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
      const { processWithConcurrency } = await import('../lib/concurrency.ts');

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

        await processWithConcurrency(rows, ctx.concurrency, async (row) => {
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
                return;
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
        });

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
    parallelizable: true,
    resettable: true,
    async run(ctx: PipelineContext): Promise<StageResult> {
      // Mirrors the CLI embed command for source=attachment
      const { DuckDBConnection } = await import('@duckdb/node-api');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const { EmbeddingService } =
        await import('../inference/embedding-service.ts');
      const { ensureEmbeddingSchema } =
        await import('../search/embedding-schema.ts');
      const { splitText, embedChunk, EMBEDDING_MAX_CHARS, EMBEDDING_OVERLAP } =
        await import('../inference/text-chunker.ts');
      const { computeTextChecksum } = await import('../lib/text-utils.ts');
      const { processWithConcurrency } = await import('../lib/concurrency.ts');

      const start: number = Date.now();
      const conn: DuckDBConnection = await DuckDBConnection.create(ctx.db);
      try {
        await ensureEmbeddingSchema(conn);
        const modelId: string = 'amazon.titan-embed-text-v2:0';
        const dimensions: number = 512;
        const region: string = process.env.AWS_REGION ?? 'us-east-2';
        const client = new BedrockClient(region);
        const service = new EmbeddingService(client);

        // Find attachments needing embeddings (exclude permanently failed)
        const sql: string = `
          SELECT CAST(a.attachment_key AS VARCHAR) AS source_key, a.full_text
          FROM attachment a
          WHERE a.full_text IS NOT NULL AND LENGTH(TRIM(a.full_text)) > 0
            AND a.indexed_by IS NULL
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

        await processWithConcurrency(rows, ctx.concurrency, async (row) => {
          const sourceKey: string = String(row.source_key);
          try {
            const text: string = String(row.full_text);
            const textChecksum: string = computeTextChecksum(text);
            const chunks: string[] = splitText(
              text,
              EMBEDDING_MAX_CHARS,
              EMBEDDING_OVERLAP,
            );

            // Delete existing embeddings
            await conn.run(
              `DELETE FROM embedding WHERE source_table = 'attachment' AND source_key = ?`,
              [sourceKey] as import('@duckdb/node-api').DuckDBValue[],
            );

            for (let ci: number = 0; ci < chunks.length; ci++) {
              const resp = await embedChunk(
                service,
                chunks[ci]!,
                modelId,
                dimensions,
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
            const errMsg: string =
              err instanceof Error ? err.message : String(err);
            ctx.log('error', `Embed failed: ${errMsg}`);
            const isPermanent: boolean =
              errMsg.includes('Too many input tokens') ||
              errMsg.includes('Max input tokens');
            if (isPermanent) {
              await conn.run(
                `UPDATE attachment SET indexed_by = 'failed', indexed_at = current_timestamp WHERE CAST(attachment_key AS VARCHAR) = ?`,
                [sourceKey] as import('@duckdb/node-api').DuckDBValue[],
              );
            }
          }
        });

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

  // ── Alerts: semantic (after attachments.embed) ──────────────────
  makeAlertStage('semantic'),

  // ── Companies ───────────────────────────────────────────────────
  {
    id: 'companies.seed',
    group: 'companies',
    name: 'Seed Companies',
    description: 'Load built-in satellite industry company dataset',
    defaultConcurrency: 1,
    parallelizable: false,
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
    defaultConcurrency: 1,
    parallelizable: false,
    resettable: true,
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
        summary: `Attributed ${String(result.attributed)}, skipped ${String(result.skipped)}${result.previouslySkipped > 0 ? `, ${String(result.previouslySkipped)} previously skipped` : ''}`,
      };
    },
  },
  {
    id: 'companies.extract-ownership',
    group: 'companies',
    name: 'Extract Ownership',
    description: 'Derive ownership events from T/C and ASG filings',
    defaultConcurrency: 1,
    parallelizable: false,
    resettable: true,
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
        summary: `Created ${String(result.created)} events, skipped ${String(result.skipped)}${result.previouslySkipped > 0 ? `, ${String(result.previouslySkipped)} previously skipped` : ''}`,
      };
    },
  },
  {
    id: 'companies.enrich',
    group: 'companies',
    name: 'Enrich Companies',
    description: 'Enrich company data from GLEIF and Wikidata',
    defaultConcurrency: 1,
    parallelizable: false,
    resettable: true,
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
    defaultConcurrency: 1,
    parallelizable: false,
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
    defaultConcurrency: 10,
    parallelizable: true,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { fetchAllDueSources } = await import('../news/rss-fetcher.ts');
      const start: number = Date.now();
      await ensureNewsTables(ctx.conn);
      const { results, totalInserted } = await fetchAllDueSources(
        ctx.conn,
        ctx.concurrency,
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
        itemsDiscovered: totalInserted,
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
    defaultConcurrency: 20,
    parallelizable: true,
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
    defaultConcurrency: 15,
    parallelizable: true,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewsTables } = await import('../news/schema.ts');
      const { summarizeNewsItems } = await import('../news/summarize-news.ts');
      const { getConfigService, setConfigService } =
        await import('../lib/config.ts');
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

      // summarizeNewsItems overwrites the global ConfigService with a
      // standalone shim (designed for CLI use). Save and restore the
      // server's real config so subsequent stages aren't corrupted.
      const savedConfig = getConfigService();
      try {
        await summarizeNewsItems(ctx.conn, {
          region: process.env.AWS_REGION ?? 'us-east-2',
          modelId: 'us.amazon.nova-pro-v1:0',
          concurrency: ctx.concurrency,
          limit: 0,
          dryRun: false,
        });
      } finally {
        setConfigService(savedConfig);
      }

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
    defaultConcurrency: 1,
    parallelizable: false,
    resettable: true,
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
        summary: `Attributed ${String(result.attributed)}, skipped ${String(result.skipped)}${result.previouslySkipped > 0 ? `, ${String(result.previouslySkipped)} previously skipped` : ''}`,
      };
    },
  },

  // ── Search ──────────────────────────────────────────────────────
  {
    id: 'search.rebuild-index',
    group: 'search',
    name: 'Rebuild FTS Index',
    description: 'Rebuild all full-text search indexes',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { rebuildAllFtsIndexes } = await import('../search/fts-index.ts');
      const start: number = Date.now();
      ctx.log('info', 'Rebuilding FTS indexes...');
      const result = await rebuildAllFtsIndexes(ctx.conn, ctx.db);
      if (result.skipped) {
        ctx.log('info', 'FTS indexes up to date');
        return {
          itemsProcessed: 0,
          itemsFailed: 0,
          durationMs: Date.now() - start,
          summary: 'FTS indexes up to date',
        };
      }
      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: 'FTS indexes rebuilt',
      };
    },
  },

  // ── Alerts: keyword (after search.rebuild-index) ────────────
  makeAlertStage('keyword'),

  // ── Newspaper ────────────────────────────────────────────────
  {
    id: 'newspaper.ensure-edition',
    group: 'newspaper',
    name: 'Create Edition',
    description:
      "Create today's newspaper edition if it doesn't exist (gates on 9am ET)",
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { ensureEdition } = await import('../newspaper/repository.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      // Gate: skip if before 9am Eastern
      const eastern: string = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
      });
      const hour: number = new Date(eastern).getHours();
      if (hour < 9) {
        ctx.log('info', 'Before 9am ET — skipping newspaper generation');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await ensureEdition(ctx.conn, today);
      ctx.log(
        'info',
        `Edition ${edition.editionDate}: status=${edition.status}`,
      );
      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },
  {
    id: 'newspaper.daily-digest',
    group: 'newspaper',
    name: 'Daily Digest',
    description:
      'Generate "300 Miles Up" lead article from today\'s filings and news',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { getEditionByDate, upsertArticle, getArticle } =
        await import('../newspaper/repository.ts');
      const { generateDailyDigest } =
        await import('../newspaper/generators/daily-digest.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const { InstrumentedBedrockClient } =
        await import('../inference/instrumented-client.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await getEditionByDate(ctx.conn, today);
      if (!edition) {
        ctx.log('info', 'No edition for today — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      // Skip if already generated
      const existing = await getArticle(ctx.conn, edition.id, 'three-miles-up');
      if (existing?.status === 'generated') {
        ctx.log('info', 'Daily digest already generated — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const client = new InstrumentedBedrockClient(
        new BedrockClient(region),
        ctx.conn,
        'newspaper',
      );
      const inferenceService = new InferenceService(client);

      const result = await generateDailyDigest({
        conn: ctx.conn,
        editionId: edition.id,
        editionDate: today,
        inferenceService,
        config,
        log: ctx.log,
      });

      await upsertArticle(ctx.conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        headline: result.headline,
        body: result.body,
        sourceData: JSON.stringify(result.sourceData),
        generatedBy: config.get('newspaperCopyModel') as string,
        displayOrder: 1,
        status: 'generated',
      });

      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },
  {
    id: 'newspaper.hero-image',
    group: 'newspaper',
    name: 'Hero Image',
    description: 'Generate front-page steel engraving from daily digest',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { getEditionByDate, upsertArticle, getArticle } =
        await import('../newspaper/repository.ts');
      const { generateHeroImage } =
        await import('../newspaper/generators/hero-image.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const { InstrumentedBedrockClient } =
        await import('../inference/instrumented-client.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await getEditionByDate(ctx.conn, today);
      if (!edition) {
        ctx.log('info', 'No edition for today — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      // Skip if already generated
      const existing = await getArticle(ctx.conn, edition.id, 'hero-image');
      if (existing?.status === 'generated') {
        ctx.log('info', 'Hero image already generated — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const imageClient = new InstrumentedBedrockClient(
        new BedrockClient(region),
        ctx.conn,
        'newspaper',
      );

      const result = await generateHeroImage({
        conn: ctx.conn,
        editionId: edition.id,
        editionDate: today,
        inferenceService: null as never, // not used by hero image generator
        config,
        imageClient,
        log: ctx.log,
      });

      await upsertArticle(ctx.conn, edition.id, {
        contentType: 'hero_image',
        slug: 'hero-image',
        headline: '',
        body: '',
        imagePath: result.imagePath ?? null,
        imagePrompt: result.imagePrompt ?? null,
        sourceData: JSON.stringify(result.sourceData),
        generatedBy: config.get('newspaperImageModel') as string,
        displayOrder: 0,
        status: 'generated',
      });

      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },
  {
    id: 'newspaper.fake-ad',
    group: 'newspaper',
    name: 'Fake Ad',
    description: 'Generate a tongue-in-cheek display advertisement',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { getEditionByDate, upsertArticle, getArticle } =
        await import('../newspaper/repository.ts');
      const { generateFakeAd } =
        await import('../newspaper/generators/fake-ad.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const { InstrumentedBedrockClient } =
        await import('../inference/instrumented-client.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await getEditionByDate(ctx.conn, today);
      if (!edition) {
        ctx.log('info', 'No edition for today — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      // Skip if already generated
      const existing = await getArticle(ctx.conn, edition.id, 'fake-ad');
      if (existing?.status === 'generated') {
        ctx.log('info', 'Fake ad already generated — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const client = new InstrumentedBedrockClient(
        new BedrockClient(region),
        ctx.conn,
        'newspaper',
      );
      const inferenceService = new InferenceService(client);

      const result = await generateFakeAd({
        conn: ctx.conn,
        editionId: edition.id,
        editionDate: today,
        inferenceService,
        config,
        log: ctx.log,
      });

      await upsertArticle(ctx.conn, edition.id, {
        contentType: 'fake_ad',
        slug: 'fake-ad',
        headline: result.headline,
        body: result.body,
        sourceData: JSON.stringify(result.sourceData),
        generatedBy: config.get('newspaperCopyModel') as string,
        displayOrder: 90,
        status: 'generated',
      });

      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },

  // ── Newspaper: Editorial Cartoon (daily) ────────────────────────
  {
    id: 'newspaper.editorial-cartoon',
    group: 'newspaper',
    name: 'Editorial Cartoon',
    description: 'Daily editorial cartoon in Punch magazine style',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { getEditionByDate, upsertArticle, getArticle } =
        await import('../newspaper/repository.ts');
      const { generateEditorialCartoon } =
        await import('../newspaper/generators/editorial-cartoon.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const { InstrumentedBedrockClient } =
        await import('../inference/instrumented-client.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await getEditionByDate(ctx.conn, today);
      if (!edition) {
        ctx.log('info', 'No edition for today — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const existing = await getArticle(
        ctx.conn,
        edition.id,
        'editorial-cartoon',
      );
      if (existing?.status === 'generated') {
        ctx.log('info', 'Editorial cartoon already generated — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const bedrockClient = new BedrockClient(region);
      const client = new InstrumentedBedrockClient(
        bedrockClient,
        ctx.conn,
        'newspaper',
      );
      const inferenceService = new InferenceService(client);

      const result = await generateEditorialCartoon({
        conn: ctx.conn,
        editionId: edition.id,
        editionDate: today,
        inferenceService,
        config,
        imageClient: client,
        log: ctx.log,
      });

      await upsertArticle(ctx.conn, edition.id, {
        contentType: 'editorial_cartoon',
        slug: 'editorial-cartoon',
        headline: '',
        body: result.body,
        imagePath: result.imagePath ?? null,
        imagePrompt: result.imagePrompt ?? null,
        sourceData: JSON.stringify(result.sourceData),
        generatedBy: config.get('newspaperImageModel') as string,
        displayOrder: 11,
        status: 'generated',
      });

      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },

  // ── Newspaper: Classifieds (daily) ────────────────────────────
  {
    id: 'newspaper.classifieds',
    group: 'newspaper',
    name: 'Classifieds',
    description: 'Daily batch of fake classified ads',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const { ensureNewspaperTables } = await import('../newspaper/schema.ts');
      const { getEditionByDate, upsertArticle, getArticle } =
        await import('../newspaper/repository.ts');
      const { generateClassifieds } =
        await import('../newspaper/generators/classifieds.ts');
      const { getConfigService } = await import('../lib/config.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const { InstrumentedBedrockClient } =
        await import('../inference/instrumented-client.ts');
      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const start: number = Date.now();
      await ensureNewspaperTables(ctx.conn);

      const today: string = new Date().toISOString().split('T')[0]!;
      const edition = await getEditionByDate(ctx.conn, today);
      if (!edition) {
        ctx.log('info', 'No edition for today — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const existing = await getArticle(ctx.conn, edition.id, 'classifieds');
      if (existing?.status === 'generated') {
        ctx.log('info', 'Classifieds already generated — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const client = new InstrumentedBedrockClient(
        new BedrockClient(region),
        ctx.conn,
        'newspaper',
      );
      const inferenceService = new InferenceService(client);

      const result = await generateClassifieds({
        conn: ctx.conn,
        editionId: edition.id,
        editionDate: today,
        inferenceService,
        config,
        log: ctx.log,
      });

      await upsertArticle(ctx.conn, edition.id, {
        contentType: 'classifieds',
        slug: 'classifieds',
        headline: result.headline,
        body: result.body,
        sourceData: JSON.stringify(result.sourceData),
        generatedBy: config.get('newspaperCopyModel') as string,
        displayOrder: 80,
        status: 'generated',
      });

      return {
        itemsProcessed: 1,
        itemsFailed: 0,
        durationMs: Date.now() - start,
      };
    },
  },

  // ── Newspaper: Slot Dispatchers (daily rotation) ──────────────
  ...(['slotA', 'slotB', 'slotC'] as const).map(
    (slotName): PipelineStage => ({
      id: `newspaper.${slotName.replace(/([A-Z])/g, '-$1').toLowerCase()}`,
      group: 'newspaper',
      name: `Slot ${slotName.slice(-1).toUpperCase()} Content`,
      description: `Daily rotation content for layout slot ${slotName.slice(-1).toUpperCase()}`,
      defaultConcurrency: 1,
      parallelizable: false,
      async run(ctx: PipelineContext): Promise<StageResult> {
        const { ensureNewspaperTables } =
          await import('../newspaper/schema.ts');
        const { ensureCompanyTables } = await import('../companies/schema.ts');
        const { getEditionByDate } = await import('../newspaper/repository.ts');
        const { dispatchSlot } =
          await import('../newspaper/slot-dispatcher.ts');
        const { getConfigService } = await import('../lib/config.ts');
        const { InferenceService } =
          await import('../inference/inference-service.ts');
        const { InstrumentedBedrockClient } =
          await import('../inference/instrumented-client.ts');
        const { BedrockClient } =
          await import('../inference/bedrock-client.ts');
        const start: number = Date.now();
        await ensureNewspaperTables(ctx.conn);
        await ensureCompanyTables(ctx.conn);

        const today: string = new Date().toISOString().split('T')[0]!;
        const edition = await getEditionByDate(ctx.conn, today);
        if (!edition) {
          ctx.log('info', 'No edition for today — skipping');
          return {
            itemsProcessed: 0,
            itemsSkipped: 1,
            itemsFailed: 0,
            durationMs: Date.now() - start,
          };
        }

        const config = getConfigService();
        const region: string = config.get('bedrockRegion') as string;
        const client = new InstrumentedBedrockClient(
          new BedrockClient(region),
          ctx.conn,
          'newspaper',
        );
        const inferenceService = new InferenceService(client);

        const result = await dispatchSlot(
          slotName,
          ctx.conn,
          edition.id,
          today,
          inferenceService,
          config,
          ctx.log,
        );

        return {
          itemsProcessed: result ? 1 : 0,
          itemsSkipped: result ? 0 : 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
          summary: result
            ? `${result.contentType}: ${result.result.headline}`
            : 'skipped',
        };
      },
    }),
  ),
  {
    id: 'newspaper.check-images',
    group: 'newspaper',
    name: 'Image Health Check',
    description:
      'HEAD-checks recent newspaper images on the CDN and warns about missing or broken URLs',
    defaultConcurrency: 1,
    parallelizable: false,
    async run(ctx: PipelineContext): Promise<StageResult> {
      const start: number = Date.now();
      const { getConfigService } = await import('../lib/config.ts');
      const { runImageHealthCheck } =
        await import('../newspaper/image-health.ts');

      const config = getConfigService();
      const appBaseUrl: string = config.get('appBaseUrl') as string;
      if (!appBaseUrl || appBaseUrl.includes('localhost')) {
        ctx.log('info', 'appBaseUrl not configured for production — skipping');
        return {
          itemsProcessed: 0,
          itemsSkipped: 1,
          itemsFailed: 0,
          durationMs: Date.now() - start,
        };
      }

      const baseUrl: string = `${appBaseUrl}/newspaper`;
      const report = await runImageHealthCheck(ctx.conn, baseUrl, 7);

      if (report.totalMissing > 0) {
        ctx.log(
          'error',
          `${String(report.totalMissing)} of ${String(report.totalChecked)} images missing or wrong content-type`,
        );
        for (const r of report.results) {
          if (r.status !== 'ok') {
            ctx.log('error', `  ${r.status}: ${r.label} → ${r.url}`);
          }
        }
      } else {
        ctx.log('info', `All ${String(report.totalChecked)} images OK`);
      }

      return {
        itemsProcessed: report.totalChecked,
        itemsFailed: report.totalMissing,
        durationMs: Date.now() - start,
        summary: `${String(report.totalOk)}/${String(report.totalChecked)} OK`,
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
  {
    id: 'alerts',
    name: 'Alerts',
    stageIds: [
      'alerts.evaluate-metadata',
      'alerts.evaluate-semantic',
      'alerts.evaluate-keyword',
    ],
  },
  {
    id: 'newspaper',
    name: 'Newspaper',
    stageIds: [
      'newspaper.ensure-edition',
      'newspaper.daily-digest',
      'newspaper.hero-image',
      'newspaper.fake-ad',
      'newspaper.editorial-cartoon',
      'newspaper.classifieds',
      'newspaper.slot-a',
      'newspaper.slot-b',
      'newspaper.slot-c',
      'newspaper.check-images',
    ],
  },
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
