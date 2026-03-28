import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_WEEK_IN_REVIEW_SYSTEM_PROMPT,
  DEFAULT_WEEK_IN_REVIEW_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type DailyCount = {
  dateFiled: string;
  count: number;
};

type TopApplicant = {
  companyName: string;
  filingCount: number;
};

type FilingTypeCount = {
  filingType: string;
  count: number;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Filing counts per day for the Mon–Fri week ending before editionDate.
 */
export async function queryWeeklyFilingStats(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<DailyCount[]> {
  const reader = await conn.runAndReadAll(
    `SELECT date_filed, COUNT(*) AS cnt
     FROM filing
     WHERE date_filed >= CAST(? AS DATE) - INTERVAL 6 DAY
       AND date_filed < CAST(? AS DATE)
     GROUP BY date_filed
     ORDER BY date_filed ASC`,
    [editionDate, editionDate] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    dateFiled: String(r.date_filed).split('T')[0]!,
    count: Number(r.cnt),
  }));
}

/**
 * Top 5 applicants (by company) for the week.
 */
export async function queryWeeklyTopApplicants(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<TopApplicant[]> {
  const reader = await conn.runAndReadAll(
    `SELECT c.name AS company_name, COUNT(*) AS filing_count
     FROM filing f
     JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     JOIN company c ON c.id = ca.company_id
     WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 6 DAY
       AND f.date_filed < CAST(? AS DATE)
     GROUP BY c.name
     ORDER BY filing_count DESC
     LIMIT 5`,
    [editionDate, editionDate] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    companyName: String(r.company_name),
    filingCount: Number(r.filing_count),
  }));
}

/**
 * Top filing type combinations (subsystem-apptype) for the week.
 */
export async function queryWeeklyFilingTypes(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<FilingTypeCount[]> {
  const reader = await conn.runAndReadAll(
    `SELECT subsystem_code || '-' || app_type_code AS filing_type, COUNT(*) AS cnt
     FROM filing
     WHERE date_filed >= CAST(? AS DATE) - INTERVAL 6 DAY
       AND date_filed < CAST(? AS DATE)
       AND subsystem_code IS NOT NULL
       AND app_type_code IS NOT NULL
     GROUP BY filing_type
     ORDER BY cnt DESC
     LIMIT 8`,
    [editionDate, editionDate] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    filingType: String(r.filing_type),
    count: Number(r.cnt),
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

export function formatWeeklyStats(rows: DailyCount[]): string {
  if (rows.length === 0) return '_No filing data available._';
  const total: number = rows.reduce((sum: number, r: DailyCount) => sum + r.count, 0);
  const lines: string[] = rows.map((r: DailyCount) => `- ${r.dateFiled}: ${String(r.count)} filings`);
  lines.push(`- **Total: ${String(total)} filings**`);
  return lines.join('\n');
}

export function formatTopApplicants(rows: TopApplicant[]): string {
  if (rows.length === 0) return '_No applicant data available._';
  return rows
    .map((r: TopApplicant) => `- ${r.companyName}: ${String(r.filingCount)} filings`)
    .join('\n');
}

export function formatFilingTypes(rows: FilingTypeCount[]): string {
  if (rows.length === 0) return '_No filing type data available._';
  return rows
    .map((r: FilingTypeCount) => `- ${r.filingType}: ${String(r.count)}`)
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateWeekInReview(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query weekly data
  log('info', 'Querying weekly filing stats for Week in Review...');
  const weeklyStats: DailyCount[] = await queryWeeklyFilingStats(conn, editionDate);
  const topApplicants: TopApplicant[] = await queryWeeklyTopApplicants(conn, editionDate);
  const filingTypes: FilingTypeCount[] = await queryWeeklyFilingTypes(conn, editionDate);

  const totalFilings: number = weeklyStats.reduce((s: number, r: DailyCount) => s + r.count, 0);
  log('info', `Found ${String(totalFilings)} filings across ${String(weeklyStats.length)} days`);

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperWeekInReviewSystemPrompt') as string) ||
    DEFAULT_WEEK_IN_REVIEW_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperWeekInReviewUserPrompt') as string) ||
    DEFAULT_WEEK_IN_REVIEW_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    weeklyFilingStats: formatWeeklyStats(weeklyStats),
    weeklyTopApplicants: formatTopApplicants(topApplicants),
    weeklyFilingTypes: formatFilingTypes(filingTypes),
  });

  // 3. Call inference
  log('info', `Generating Week in Review with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  const body: string = response.content;
  const headline: string = 'The Week in Review';

  return {
    headline,
    body,
    sourceData: {
      totalFilings,
      daysWithFilings: weeklyStats.length,
      topApplicants: topApplicants.map((r: TopApplicant) => r.companyName),
      topFilingTypes: filingTypes.map((r: FilingTypeCount) => r.filingType),
      modelId,
    },
  };
}
