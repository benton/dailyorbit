import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_TECH_SPOTLIGHT_SYSTEM_PROMPT,
  DEFAULT_TECH_SPOTLIGHT_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type TechNewsItem = {
  title: string;
  sourceName: string;
  summary: string;
  sourceUrl: string;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Query recent news items filtered for technology-related content.
 */
export async function queryTechNews(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<TechNewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.title, ns.name AS source_name, ni.summary, ni.source_url
     FROM news_item ni
     JOIN news_source ns ON ns.id = ni.news_source_id
     WHERE ni.published_at >= CAST(? AS TIMESTAMP) - INTERVAL 7 DAY
       AND ni.published_at <= CAST(? AS TIMESTAMP) + INTERVAL 1 DAY
       AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
       AND (
         LOWER(ni.title) LIKE '%technology%'
         OR LOWER(ni.title) LIKE '%antenna%'
         OR LOWER(ni.title) LIKE '%spectrum%'
         OR LOWER(ni.title) LIKE '%phased array%'
         OR LOWER(ni.title) LIKE '%optical%'
         OR LOWER(ni.title) LIKE '%frequency%'
         OR LOWER(ni.title) LIKE '%band%'
         OR LOWER(ni.title) LIKE '%satellite%'
         OR LOWER(ni.summary) LIKE '%technology%'
         OR LOWER(ni.summary) LIKE '%innovation%'
       )
     ORDER BY ni.published_at DESC
     LIMIT 10`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    title: String(r.title),
    sourceName: String(r.source_name),
    summary: String(r.summary),
    sourceUrl: String(r.source_url),
  }));
}

/**
 * Fallback: query general recent news if tech-specific results are too few.
 */
export async function queryGeneralNews(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<TechNewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.title, ns.name AS source_name, ni.summary, ni.source_url
     FROM news_item ni
     JOIN news_source ns ON ns.id = ni.news_source_id
     WHERE ni.published_at >= CAST(? AS TIMESTAMP) - INTERVAL 7 DAY
       AND ni.published_at <= CAST(? AS TIMESTAMP) + INTERVAL 1 DAY
       AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
     ORDER BY ni.published_at DESC
     LIMIT 10`,
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

export function formatEditionDate(isoDate: string): string {
  const d: Date = new Date(isoDate + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTechNews(items: TechNewsItem[]): string {
  if (items.length === 0) return '_No recent technology news._';
  return items
    .map(
      (n: TechNewsItem) =>
        `- ${n.sourceName}: ${n.title} — ${n.summary.slice(0, 200)} (${n.sourceUrl})`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateTechSpotlight(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query tech-specific news
  log('info', 'Querying technology news for tech spotlight...');
  let newsItems: TechNewsItem[] = await queryTechNews(conn, editionDate);

  // 2. Fall back to general news if fewer than 3 tech results
  if (newsItems.length < 3) {
    log(
      'info',
      `Only ${String(newsItems.length)} tech news items; falling back to general news`,
    );
    newsItems = await queryGeneralNews(conn, editionDate);
  }

  log('info', `Found ${String(newsItems.length)} news items for tech spotlight`);

  // 3. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperTechSpotlightSystemPrompt') as string) ||
    DEFAULT_TECH_SPOTLIGHT_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperTechSpotlightUserPrompt') as string) ||
    DEFAULT_TECH_SPOTLIGHT_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    newsSummaries: formatTechNews(newsItems),
  });

  // 4. Call inference
  log('info', `Generating tech spotlight with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'Technology Spotlight';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      newsCount: newsItems.length,
      modelId,
    },
  };
}
