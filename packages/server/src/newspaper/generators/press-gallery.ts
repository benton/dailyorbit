import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_PRESS_GALLERY_SYSTEM_PROMPT,
  DEFAULT_PRESS_GALLERY_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import { formatEditionDate } from './editorial.ts';

// ── Data types for query results ────────────────────────────────

type WeeklyNewsItem = {
  title: string;
  sourceName: string;
  summary: string;
  sourceUrl: string;
};

// ── Query helpers ───────────────────────────────────────────────

export async function queryWeeklyNewsAll(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<WeeklyNewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.title, ns.name AS source_name, ni.summary, ni.source_url
     FROM news_item ni
     JOIN news_source ns ON ns.id = ni.news_source_id
     WHERE ni.published_at >= CAST(? AS TIMESTAMP) - INTERVAL 7 DAY
       AND ni.published_at <= CAST(? AS TIMESTAMP) + INTERVAL 1 DAY
       AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
     ORDER BY ni.published_at DESC
     LIMIT 30`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    title: String(r.title),
    sourceName: String(r.source_name),
    summary: String(r.summary),
    sourceUrl: String(r.source_url),
  }));
}

// ── Formatters ──────────────────────────────────────────────────

function formatWeeklyNews(news: WeeklyNewsItem[]): string {
  if (news.length === 0) return '_No news coverage this week._';
  return news
    .map(
      (n: WeeklyNewsItem) =>
        `- ${n.sourceName}: ${n.title} — ${n.summary.slice(0, 200)}`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generatePressGallery(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query all news from the current week
  log('info', 'Querying weekly news for press gallery...');
  const news: WeeklyNewsItem[] = await queryWeeklyNewsAll(conn, editionDate);

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemTemplate: string =
    (config.get('newspaperPressGallerySystemPrompt') as string) ||
    DEFAULT_PRESS_GALLERY_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperPressGalleryUserPrompt') as string) ||
    DEFAULT_PRESS_GALLERY_USER_PROMPT;

  const vars: Record<string, string> = {
    editionDate: formatEditionDate(editionDate),
    weeklyNews: formatWeeklyNews(news),
  };

  const systemPrompt: string = renderPrompt(systemTemplate, vars);
  const userPrompt: string = renderPrompt(userTemplate, vars);

  // 3. Call inference
  log('info', `Generating press gallery with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'From the Press Gallery';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      newsCount: news.length,
      sources: [...new Set(news.map((n: WeeklyNewsItem) => n.sourceName))],
      modelId,
    },
  };
}
