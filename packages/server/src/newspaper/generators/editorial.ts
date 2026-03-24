import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_EDITORIAL_SYSTEM_PROMPT,
  DEFAULT_EDITORIAL_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import { getISOWeekNumber } from '../types.ts';

// ── Persona rotation ────────────────────────────────────────────

export type EditorialPersona = {
  readonly name: string;
  readonly angle: string;
  readonly voice: string;
};

export const PERSONAS: readonly EditorialPersona[] = [
  {
    name: 'The Strategist',
    angle: 'competitive dynamics',
    voice:
      'analytical and sharp, focused on corporate maneuvering and market position',
  },
  {
    name: 'The Counsel',
    angle: 'regulatory trends',
    voice:
      'measured and authoritative, focused on what FCC actions signal for the industry',
  },
  {
    name: 'The Engineer',
    angle: 'technology and spectrum',
    voice:
      'technically curious, focused on what new filings mean for spectrum usage and satellite technology',
  },
] as const;

export function getCurrentPersona(date?: Date): EditorialPersona {
  const weekNumber: number = getISOWeekNumber(date ?? new Date());
  return PERSONAS[weekNumber % 3]!;
}

// ── Data types for query results ────────────────────────────────

type FilingTrend = {
  fileNumber: string;
  applicantName: string;
  dateFiled: string;
  summary: string;
};

type NewsTrend = {
  title: string;
  sourceName: string;
  summary: string;
};

// ── Query helpers ───────────────────────────────────────────────

export async function queryWeeklyFilings(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<FilingTrend[]> {
  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, f.address_attention AS applicant_name,
            CAST(f.date_filed AS VARCHAR) AS date_filed,
            a.summary
     FROM filing f
     JOIN attachment a ON a.filing_key = f.filing_key
     WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
       AND f.date_filed <= CAST(? AS DATE)
       AND a.summary IS NOT NULL AND LENGTH(a.summary) > 0
     ORDER BY f.date_filed DESC
     LIMIT 30`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    fileNumber: String(r.file_number),
    applicantName: String(r.applicant_name ?? ''),
    dateFiled: String(r.date_filed ?? ''),
    summary: String(r.summary),
  }));
}

export async function queryWeeklyNews(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<NewsTrend[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.title, ns.name AS source_name, ni.summary
     FROM news_item ni
     JOIN news_source ns ON ns.id = ni.news_source_id
     WHERE ni.published_at >= CAST(? AS TIMESTAMP) - INTERVAL 7 DAY
       AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
     ORDER BY ni.published_at DESC
     LIMIT 20`,
    [editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    title: String(r.title),
    sourceName: String(r.source_name),
    summary: String(r.summary),
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

export function formatFilingTrends(filings: FilingTrend[]): string {
  if (filings.length === 0) return '_No notable filings this week._';
  return filings
    .map(
      (f: FilingTrend) =>
        `- ${f.fileNumber}: ${f.applicantName} — ${f.summary.slice(0, 200)}`,
    )
    .join('\n');
}

export function formatNewsTrends(news: NewsTrend[]): string {
  if (news.length === 0) return '_No recent industry news._';
  return news
    .map(
      (n: NewsTrend) =>
        `- ${n.sourceName}: ${n.title} — ${n.summary.slice(0, 200)}`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateEditorial(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Get persona based on week number
  const persona: EditorialPersona = getCurrentPersona(
    new Date(editionDate + 'T12:00:00Z'),
  );
  log('info', `Editorial persona: ${persona.name} (${persona.angle})`);

  // 2. Query recent filing trends + news summaries (last 7 days)
  log('info', 'Querying weekly filings and news for editorial...');
  const filings: FilingTrend[] = await queryWeeklyFilings(conn, editionDate);
  const news: NewsTrend[] = await queryWeeklyNews(conn, editionDate);

  // 3. Build prompt with persona voice + data
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemTemplate: string =
    (config.get('newspaperEditorialSystemPrompt') as string) ||
    DEFAULT_EDITORIAL_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperEditorialUserPrompt') as string) ||
    DEFAULT_EDITORIAL_USER_PROMPT;

  const vars: Record<string, string> = {
    editionDate: formatEditionDate(editionDate),
    personaName: persona.name,
    personaAngle: persona.angle,
    personaVoice: persona.voice,
    filingSummaries: formatFilingTrends(filings),
    newsSummaries: formatNewsTrends(news),
  };

  const systemPrompt: string = renderPrompt(systemTemplate, vars);
  const userPrompt: string = renderPrompt(userTemplate, vars);

  // 4. Call inference
  log('info', `Generating editorial with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response — extract headline, ensure byline
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'Over the Horizon';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      persona: persona.name,
      angle: persona.angle,
      filingCount: filings.length,
      newsCount: news.length,
      modelId,
    },
  };
}
