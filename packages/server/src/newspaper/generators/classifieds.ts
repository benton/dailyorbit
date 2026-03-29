import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_CLASSIFIEDS_SYSTEM_PROMPT,
  DEFAULT_CLASSIFIEDS_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Query helpers ───────────────────────────────────────────────

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

// ── Formatters ──────────────────────────────────────────────────

export function formatCompanyNames(names: string[]): string {
  if (names.length === 0) return '_No companies available._';
  return names.map((n: string) => `- ${n}`).join('\n');
}

export function formatFilingTypes(types: string[]): string {
  if (types.length === 0) return '_No recent filings._';
  return types.map((t: string) => `- ${t}`).join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateClassifieds(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query input data
  log('info', 'Querying companies and filing types for classifieds...');
  const companyNames: string[] = await queryRandomCompanies(conn, 8);
  const filingTypes: string[] = await queryRecentFilingTypes(conn, editionDate);

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperClassifiedsSystemPrompt') as string) ||
    DEFAULT_CLASSIFIEDS_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperClassifiedsUserPrompt') as string) ||
    DEFAULT_CLASSIFIEDS_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    companyNames: formatCompanyNames(companyNames),
    recentFilingTypes: formatFilingTypes(filingTypes),
  });

  // 3. Call inference — retry up to 3 times on content-filter blocks
  const MAX_ATTEMPTS: number = 3;
  let body: string = '';
  for (let attempt: number = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const temperature: number = 0.7 + (attempt - 1) * 0.1;
    log(
      'info',
      `Generating classifieds with ${modelId} (attempt ${String(attempt)}, temp=${String(temperature)})...`,
    );
    const response = await inferenceService.complete({
      modelId,
      messages: [{ role: 'user' as const, content: userPrompt }],
      params: { systemPrompt, temperature },
    });

    body = response.content;
    const lc: string = body.toLowerCase();
    if (body.length < 200 && lc.includes('blocked') && lc.includes('filter')) {
      log('info', `Attempt ${String(attempt)} hit content filter, retrying...`);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `Classifieds blocked by content filter after ${String(MAX_ATTEMPTS)} attempts: ${body.slice(0, 120)}`,
        );
      }
      continue;
    }
    break;
  }
  const headline: string = 'Classifieds';

  // Determine display_order based on day-of-week (0=Sunday through 6=Saturday)
  const editionDay: number = new Date(editionDate + 'T12:00:00Z').getUTCDay();

  return {
    headline,
    body,
    sourceData: {
      companyNames,
      filingTypes,
      displayDay: editionDay,
      modelId,
    },
  };
}
