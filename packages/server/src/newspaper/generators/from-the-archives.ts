import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_ARCHIVES_SYSTEM_PROMPT,
  DEFAULT_ARCHIVES_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import { getISOWeekNumber } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type HistoricalFiling = {
  fileNumber: string;
  applicantName: string;
  dateFiled: string;
  subsystemCode: string;
  appTypeCode: string;
  summary: string | null;
  companyName: string | null;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Query filings from the same ISO week in prior years.
 * Prefer filings from known companies and those with attachment summaries.
 */
export async function queryHistoricalFilings(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<HistoricalFiling[]> {
  const weekNumber: number = getISOWeekNumber(
    new Date(editionDate + 'T12:00:00Z'),
  );

  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, f.address_attention AS applicant_name,
            CAST(f.date_filed AS VARCHAR) AS date_filed,
            f.subsystem_code, f.app_type_code,
            a.summary,
            c.name AS company_name
     FROM filing f
     LEFT JOIN attachment a ON a.filing_key = f.filing_key AND a.summary IS NOT NULL
     LEFT JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     LEFT JOIN company c ON c.id = ca.company_id
     WHERE EXTRACT(WEEK FROM f.date_filed) = ?
       AND EXTRACT(YEAR FROM f.date_filed) < EXTRACT(YEAR FROM CAST(? AS DATE))
       AND f.subsystem_code IS NOT NULL
     ORDER BY
       CASE WHEN c.name IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN a.summary IS NOT NULL THEN 0 ELSE 1 END,
       f.date_filed DESC
     LIMIT 15`,
    [weekNumber, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    fileNumber: String(r.file_number),
    applicantName: String(r.applicant_name ?? ''),
    dateFiled: String(r.date_filed ?? ''),
    subsystemCode: String(r.subsystem_code),
    appTypeCode: String(r.app_type_code ?? ''),
    summary: r.summary != null ? String(r.summary) : null,
    companyName: r.company_name != null ? String(r.company_name) : null,
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

export function formatHistoricalFilings(filings: HistoricalFiling[]): string {
  if (filings.length === 0) return '_No historical filings found for this week._';
  return filings
    .map((f: HistoricalFiling) => {
      const company: string = f.companyName ?? f.applicantName;
      const summarySnippet: string = f.summary
        ? ': ' + f.summary.slice(0, 150)
        : '';
      return `- ${f.fileNumber} (${f.dateFiled}): ${company} — ${f.subsystemCode}-${f.appTypeCode}${summarySnippet}`;
    })
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateFromTheArchives(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query historical filings from the same ISO week in prior years
  const weekNumber: number = getISOWeekNumber(
    new Date(editionDate + 'T12:00:00Z'),
  );
  log('info', `Querying historical filings for ISO week ${String(weekNumber)}...`);
  const filings: HistoricalFiling[] = await queryHistoricalFilings(
    conn,
    editionDate,
  );
  log('info', `Found ${String(filings.length)} historical filings`);

  if (filings.length === 0) {
    return {
      headline: 'From the Archives',
      body: '_No historical filings found for this week in prior years._',
      sourceData: { weekNumber, filingCount: 0 },
    };
  }

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperArchivesSystemPrompt') as string) ||
    DEFAULT_ARCHIVES_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperArchivesUserPrompt') as string) ||
    DEFAULT_ARCHIVES_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    historicalFilings: formatHistoricalFilings(filings),
  });

  // 3. Call inference
  log('info', `Generating From the Archives with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'From the Archives';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      weekNumber,
      filingCount: filings.length,
      modelId,
    },
  };
}
