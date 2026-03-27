import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_DOCKET_SYSTEM_PROMPT,
  DEFAULT_DOCKET_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type SubsystemCount = {
  subsystemCode: string;
  count: number;
};

type TopApplicant = {
  companyName: string;
  filingCount: number;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Count yesterday's filings grouped by subsystem code.
 */
export async function queryYesterdayFilingsBySubsystem(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<SubsystemCount[]> {
  const reader = await conn.runAndReadAll(
    `SELECT subsystem_code, COUNT(*) AS cnt
     FROM filing
     WHERE date_filed = CAST(? AS DATE) - INTERVAL 1 DAY
       AND subsystem_code IS NOT NULL
     GROUP BY subsystem_code
     ORDER BY cnt DESC`,
    [editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    subsystemCode: String(r.subsystem_code),
    count: Number(r.cnt),
  }));
}

/**
 * Get the top 5 applicants from yesterday's filings.
 */
export async function queryYesterdayTopApplicants(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<TopApplicant[]> {
  const reader = await conn.runAndReadAll(
    `SELECT c.name AS company_name, COUNT(*) AS filing_count
     FROM filing f
     JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     JOIN company c ON c.id = ca.company_id
     WHERE f.date_filed = CAST(? AS DATE) - INTERVAL 1 DAY
     GROUP BY c.name
     ORDER BY filing_count DESC
     LIMIT 5`,
    [editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    companyName: String(r.company_name),
    filingCount: Number(r.filing_count),
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

export function formatFilingsBySubsystem(rows: SubsystemCount[]): string {
  if (rows.length === 0) return '_No filing data available._';
  return rows
    .map(
      (r: SubsystemCount) => `- ${r.subsystemCode}: ${String(r.count)} filings`,
    )
    .join('\n');
}

export function formatTopApplicants(rows: TopApplicant[]): string {
  if (rows.length === 0) return '_No applicant data available._';
  return rows
    .map(
      (r: TopApplicant) =>
        `- ${r.companyName}: ${String(r.filingCount)} filings`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateTheDocket(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query data
  log('info', "Querying yesterday's filing activity for The Docket...");
  const filingsBySubsystem: SubsystemCount[] =
    await queryYesterdayFilingsBySubsystem(conn, editionDate);
  const topApplicants: TopApplicant[] = await queryYesterdayTopApplicants(
    conn,
    editionDate,
  );

  log(
    'info',
    `Found ${String(filingsBySubsystem.length)} subsystems, ${String(topApplicants.length)} top applicants`,
  );

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperDocketSystemPrompt') as string) ||
    DEFAULT_DOCKET_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperDocketUserPrompt') as string) ||
    DEFAULT_DOCKET_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    filingsBySubsystem: formatFilingsBySubsystem(filingsBySubsystem),
    topApplicants: formatTopApplicants(topApplicants),
  });

  // 3. Call inference
  log('info', `Generating The Docket with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? 'The Docket';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      filingsBySubsystem: filingsBySubsystem.map(
        (r: SubsystemCount) => `${r.subsystemCode}: ${String(r.count)}`,
      ),
      topApplicants: topApplicants.map((r: TopApplicant) => r.companyName),
      modelId,
    },
  };
}
