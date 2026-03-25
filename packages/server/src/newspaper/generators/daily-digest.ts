import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_DIGEST_SYSTEM_PROMPT,
  DEFAULT_DIGEST_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types for query results ────────────────────────────────────

type FilingSummary = {
  fileNumber: string;
  applicantName: string;
  dateFiled: string;
  summary: string;
};

type NewsSummary = {
  id: number;
  title: string;
  sourceUrl: string;
  sourceName: string;
  summary: string;
};

// ── Query helpers ───────────────────────────────────────────────────

export async function queryRecentFilings(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<FilingSummary[]> {
  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, f.address_attention AS applicant_name,
            CAST(f.date_filed AS VARCHAR) AS date_filed,
            a.summary
     FROM filing f
     JOIN attachment a ON a.filing_key = f.filing_key
     WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 1 DAY
       AND f.date_filed <= CAST(? AS DATE)
       AND a.summary IS NOT NULL AND LENGTH(a.summary) > 0
     ORDER BY f.date_filed DESC
     LIMIT 20`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    fileNumber: String(r.file_number),
    applicantName: String(r.applicant_name ?? ''),
    dateFiled: String(r.date_filed ?? ''),
    summary: String(r.summary),
  }));
}

export async function queryRecentNews(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<NewsSummary[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.id, ni.title, ni.source_url, ns.name AS source_name, ni.summary
     FROM news_item ni
     JOIN news_source ns ON ns.id = ni.news_source_id
     WHERE ni.published_at >= CAST(? AS TIMESTAMP) - INTERVAL 1 DAY
       AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
     ORDER BY ni.published_at DESC
     LIMIT 15`,
    [editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    title: String(r.title),
    sourceUrl: String(r.source_url),
    sourceName: String(r.source_name),
    summary: String(r.summary),
  }));
}

// ── Formatters ──────────────────────────────────────────────────────

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

export function formatFilingSummaries(filings: FilingSummary[]): string {
  if (filings.length === 0) return '_No notable filings today._';
  return filings
    .map(
      (f: FilingSummary) =>
        `- ${f.fileNumber}: ${f.applicantName} — ${f.summary.slice(0, 200)}`,
    )
    .join('\n');
}

export function formatNewsSummaries(news: NewsSummary[]): string {
  if (news.length === 0) return '_No recent industry news._';
  return news
    .map(
      (n: NewsSummary) =>
        `- ${n.sourceName}: ${n.title} — ${n.summary.slice(0, 200)}`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────────

export async function generateDailyDigest(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query input data
  log('info', 'Querying recent filings and news...');
  const filings: FilingSummary[] = await queryRecentFilings(conn, editionDate);
  const news: NewsSummary[] = await queryRecentNews(conn, editionDate);

  if (filings.length === 0 && news.length === 0) {
    return {
      headline: 'A Quiet Day on the Docket',
      body: 'No new filings or notable industry developments were recorded.',
      sourceData: { filings: [], news: [] },
    };
  }

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperCopySystemPrompt') as string) ||
    DEFAULT_DIGEST_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperCopyUserPrompt') as string) ||
    DEFAULT_DIGEST_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    filingSummaries: formatFilingSummaries(filings),
    newsSummaries: formatNewsSummaries(news),
  });

  // 3. Call inference
  log('info', `Generating daily digest with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? '300 Miles Up';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      filings: filings.map((f: FilingSummary) => f.fileNumber),
      news: news.map((n: NewsSummary) => ({
        id: n.id,
        title: n.title,
        sourceUrl: n.sourceUrl,
      })),
      modelId,
    },
  };
}
