import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { BedrockClient } from '../inference/bedrock-client.ts';
import { InferenceService } from '../inference/inference-service.ts';
import { renderPrompt } from '../inference/prompts.ts';
import { NEWS_ARTICLE_SUMMARIZER } from '../inference/summarizers/news-article.ts';
import { splitText } from '../inference/text-chunker.ts';
import { processWithConcurrency } from '../lib/concurrency.ts';
import { setConfigService } from '../lib/config.ts';
import type {
  InferenceRequest,
  InferenceResponse,
} from '../inference/types.ts';
import type { NewsItem } from './types.ts';
import {
  findExistingNewsItemSummaryByChecksum,
  getNewsItemsNeedingSummary,
  saveNewsItemSummary,
} from './repository.ts';

// ── Minimal ConfigService shim for standalone CLI usage ─────────────

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

// ── Options ─────────────────────────────────────────────────────────

type SummarizeOptions = {
  region: string;
  modelId: string;
  concurrency: number;
  limit: number;
  dryRun: boolean;
};

// ── Summarize a single news item ────────────────────────────────────

async function summarizeOne(
  service: InferenceService,
  modelId: string,
  systemPrompt: string,
  userPromptTemplate: string,
  item: NewsItem,
  sourceName: string,
  chunkSize: number,
): Promise<InferenceResponse> {
  const vars: Record<string, string> = {
    sourceUrl: item.sourceUrl,
    sourceName,
    title: item.title,
    author: item.author ?? '(unknown)',
    publishedAt: item.publishedAt ?? '(unknown)',
    fullText: item.fullText ?? '',
    tags: item.tags.join(', '),
  };

  if ((item.fullText ?? '').length > chunkSize) {
    return summarizeChunked(
      service,
      modelId,
      systemPrompt,
      item,
      sourceName,
      chunkSize,
    );
  }

  const request: InferenceRequest = {
    modelId,
    messages: [
      { role: 'user', content: renderPrompt(userPromptTemplate, vars) },
    ],
    params: {
      systemPrompt,
      maxTokens: 512,
      temperature: 0.3,
    },
  };
  return service.complete(request);
}

// ── Map-reduce chunked summarization ────────────────────────────────

async function summarizeChunked(
  service: InferenceService,
  modelId: string,
  systemPrompt: string,
  item: NewsItem,
  sourceName: string,
  chunkSize: number,
): Promise<InferenceResponse> {
  const chunks: string[] = splitText(item.fullText ?? '', chunkSize);
  const config = NEWS_ARTICLE_SUMMARIZER;

  const baseVars: Record<string, string> = {
    sourceUrl: item.sourceUrl,
    sourceName,
    title: item.title,
    author: item.author ?? '(unknown)',
    publishedAt: item.publishedAt ?? '(unknown)',
    tags: item.tags.join(', '),
  };

  const subSummaries: string[] = [];
  let totalInputTokens: number = 0;
  let totalOutputTokens: number = 0;
  let totalLatencyMs: number = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkVars: Record<string, string> = {
      ...baseVars,
      fullText: chunks[i]!,
      chunkIndex: String(i + 1),
      totalChunks: String(chunks.length),
    };

    const mapRequest: InferenceRequest = {
      modelId,
      messages: [
        {
          role: 'user',
          content: renderPrompt(config.defaultChunkUserPrompt, chunkVars),
        },
      ],
      params: { systemPrompt, maxTokens: 512, temperature: 0.3 },
    };

    const mapResp: InferenceResponse = await service.complete(mapRequest);
    subSummaries.push(mapResp.content);
    totalInputTokens += mapResp.usage.inputTokens;
    totalOutputTokens += mapResp.usage.outputTokens;
    totalLatencyMs += mapResp.latencyMs;
  }

  const reduceVars: Record<string, string> = {
    ...baseVars,
    subSummaries: subSummaries.join('\n\n'),
  };

  const reduceRequest: InferenceRequest = {
    modelId,
    messages: [
      {
        role: 'user',
        content: renderPrompt(config.defaultReduceUserPrompt, reduceVars),
      },
    ],
    params: { systemPrompt, maxTokens: 512, temperature: 0.3 },
  };

  const reduceResp: InferenceResponse = await service.complete(reduceRequest);

  return {
    content: reduceResp.content,
    modelId: reduceResp.modelId,
    usage: {
      inputTokens: totalInputTokens + reduceResp.usage.inputTokens,
      outputTokens: totalOutputTokens + reduceResp.usage.outputTokens,
      totalTokens:
        totalInputTokens +
        totalOutputTokens +
        reduceResp.usage.inputTokens +
        reduceResp.usage.outputTokens,
    },
    stopReason: reduceResp.stopReason,
    latencyMs: totalLatencyMs + reduceResp.latencyMs,
  };
}

// ── Resolve source name for a news item ─────────────────────────────

async function getSourceName(
  conn: DuckDBConnection,
  newsSourceId: number,
): Promise<string> {
  const reader = await conn.runAndReadAll(
    `SELECT name FROM news_source WHERE id = $1`,
    [newsSourceId] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  return rows.length > 0 ? String(rows[0]!.name) : '(unknown source)';
}

// ── Main pipeline entry point ───────────────────────────────────────

export async function summarizeNewsItems(
  conn: DuckDBConnection,
  opts: SummarizeOptions,
): Promise<void> {
  const config = NEWS_ARTICLE_SUMMARIZER;
  const chunkSize: number = 60_000;

  const shim = new StandaloneConfig({
    bedrockRegion: opts.region,
    bedrockDefaultModel: opts.modelId,
    [`${config.configKeyPrefix}Model`]: opts.modelId,
  });
  setConfigService(shim as never);

  const client = new BedrockClient(opts.region);
  const service = new InferenceService(client);

  const systemPrompt: string = config.defaultSystemPrompt;
  const userPromptTemplate: string = config.defaultUserPrompt;

  // Count remaining
  const countReader = await conn.runAndReadAll(
    `SELECT COUNT(*) AS cnt FROM news_item WHERE full_text IS NOT NULL AND summary IS NULL`,
  );
  const remaining: number = Number(countReader.getRowObjectsJS()[0]!.cnt);
  const target: number =
    opts.limit > 0 ? Math.min(opts.limit, remaining) : remaining;

  console.log(`News items needing summary: ${String(remaining)}`);
  console.log(
    `Target: ${String(target)} | Model: ${opts.modelId} | Concurrency: ${String(opts.concurrency)}`,
  );

  if (opts.dryRun) {
    console.log('Dry run — exiting.');
    return;
  }

  if (target === 0) {
    console.log('Nothing to summarize.');
    return;
  }

  // Cache source names to avoid repeated lookups
  const sourceNameCache: Map<number, string> = new Map();

  let processed: number = 0;
  let copied: number = 0;
  let errors: number = 0;
  let totalInputTokens: number = 0;
  let totalOutputTokens: number = 0;
  const startTime: number = performance.now();

  while (processed < target) {
    const batchSize: number = Math.min(100, target - processed);
    const items: NewsItem[] = await getNewsItemsNeedingSummary(conn, batchSize);
    if (items.length === 0) break;

    await processWithConcurrency(
      items,
      opts.concurrency,
      async (item: NewsItem) => {
        try {
          // Checksum dedup
          if (item.textChecksum != null) {
            const existing: string | null =
              await findExistingNewsItemSummaryByChecksum(
                conn,
                item.textChecksum,
              );
            if (existing != null) {
              await saveNewsItemSummary(conn, item.id, existing, 'copied');
              copied++;
              return;
            }
          }

          // Resolve source name
          let sourceName: string | undefined = sourceNameCache.get(
            item.newsSourceId,
          );
          if (sourceName == null) {
            sourceName = await getSourceName(conn, item.newsSourceId);
            sourceNameCache.set(item.newsSourceId, sourceName);
          }

          const resp: InferenceResponse = await summarizeOne(
            service,
            opts.modelId,
            systemPrompt,
            userPromptTemplate,
            item,
            sourceName,
            chunkSize,
          );

          await saveNewsItemSummary(conn, item.id, resp.content, opts.modelId);
          totalInputTokens += resp.usage.inputTokens;
          totalOutputTokens += resp.usage.outputTokens;
        } catch (err: unknown) {
          const msg: string = err instanceof Error ? err.message : String(err);
          process.stderr.write(`\nERROR [${item.sourceUrl}]: ${msg}\n`);
          errors++;
        }
      },
    );

    processed += items.length;
    const elapsed: number = Math.round((performance.now() - startTime) / 1000);
    const rate: number = elapsed > 0 ? processed / elapsed : processed;
    const eta: number = rate > 0 ? Math.round((target - processed) / rate) : 0;
    process.stdout.write(
      `\r  ${String(processed)} / ${String(target)} | ${rate.toFixed(1)} docs/s | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)} | errors: ${String(errors)}`,
    );
  }

  const wallSec: number = Math.round((performance.now() - startTime) / 1000);
  console.log('\n');
  console.log('=== News Summarization Complete ===');
  console.log(`  Processed:      ${String(processed)}`);
  console.log(`  Copied (dedup): ${String(copied)}`);
  console.log(`  Errors:         ${String(errors)}`);
  console.log(`  Input tokens:   ${String(totalInputTokens)}`);
  console.log(`  Output tokens:  ${String(totalOutputTokens)}`);
  console.log(`  Wall time:      ${formatDuration(wallSec)}`);
}

function formatDuration(totalSeconds: number): string {
  const hrs: number = Math.floor(totalSeconds / 3600);
  const mins: number = Math.floor((totalSeconds % 3600) / 60);
  const secs: number = totalSeconds % 60;
  if (hrs > 0) return `${String(hrs)}h${String(mins).padStart(2, '0')}m`;
  if (mins > 0) return `${String(mins)}m${String(secs).padStart(2, '0')}s`;
  return `${String(secs)}s`;
}
