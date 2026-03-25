import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_AD_SYSTEM_PROMPT,
  DEFAULT_AD_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Query helpers ───────────────────────────────────────────────────

export async function queryRandomCompanies(
  conn: DuckDBConnection,
  limit: number,
): Promise<string[]> {
  const reader = await conn.runAndReadAll(
    `SELECT name FROM company ORDER BY random() LIMIT ?`,
    [limit] as DuckDBValue[],
  );
  return reader
    .getRowObjectsJS()
    .map((r: Record<string, unknown>) => String(r.name));
}

export async function queryRecentFilingTypes(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<string[]> {
  const reader = await conn.runAndReadAll(
    `SELECT DISTINCT subsystem_code || '-' || app_type_code AS filing_type
     FROM filing
     WHERE date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
       AND date_filed <= CAST(? AS DATE)
       AND subsystem_code IS NOT NULL
       AND app_type_code IS NOT NULL
     ORDER BY random()
     LIMIT 5`,
    [editionDate, editionDate] as DuckDBValue[],
  );
  return reader
    .getRowObjectsJS()
    .map((r: Record<string, unknown>) => String(r.filing_type));
}

// ── Formatters ──────────────────────────────────────────────────────

export function formatCompanyNames(names: string[]): string {
  if (names.length === 0) return '_No companies available._';
  return names.map((n: string) => `- ${n}`).join('\n');
}

export function formatFilingTypes(types: string[]): string {
  if (types.length === 0) return '_No recent filings._';
  return types.map((t: string) => `- ${t}`).join('\n');
}

function formatEditionDate(isoDate: string): string {
  const d: Date = new Date(isoDate + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// ── Generator ───────────────────────────────────────────────────────

export async function generateFakeAd(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query input data
  log('info', 'Querying companies and filing types for ad...');
  const companyNames: string[] = await queryRandomCompanies(conn, 5);
  const filingTypes: string[] = await queryRecentFilingTypes(conn, editionDate);

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperAdSystemPrompt') as string) ||
    DEFAULT_AD_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperAdUserPrompt') as string) || DEFAULT_AD_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    companyNames: formatCompanyNames(companyNames),
    recentFilingTypes: formatFilingTypes(filingTypes),
  });

  // 3. Call inference
  log('info', `Generating fake ad with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response — extract headline from first markdown heading
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'ACME SATELLITE CO.';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      companyNames,
      filingTypes,
      modelId,
    },
  };
}
