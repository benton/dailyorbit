import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_COMPETITIVE_INTEL_SYSTEM_PROMPT,
  DEFAULT_COMPETITIVE_INTEL_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type CompanyOverlapRow = {
  subsystemCode: string;
  appTypeCode: string;
  companies: string;
  companyCount: number;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Find subsystem/app-type combinations where multiple companies filed this week.
 */
export async function queryCompanyOverlaps(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<CompanyOverlapRow[]> {
  const reader = await conn.runAndReadAll(
    `WITH company_subsystems AS (
       SELECT c.name AS company_name,
              f.subsystem_code,
              f.app_type_code,
              COUNT(*) AS cnt
       FROM filing f
       JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
       JOIN company c ON c.id = ca.company_id
       WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
         AND f.date_filed <= CAST(? AS DATE)
         AND f.subsystem_code IS NOT NULL
       GROUP BY c.name, f.subsystem_code, f.app_type_code
     ),
     overlaps AS (
       SELECT subsystem_code, app_type_code,
              STRING_AGG(company_name || ' (' || CAST(cnt AS VARCHAR) || ')', ', '
                         ORDER BY cnt DESC) AS companies,
              COUNT(DISTINCT company_name) AS company_count
       FROM company_subsystems
       GROUP BY subsystem_code, app_type_code
       HAVING COUNT(DISTINCT company_name) >= 2
     )
     SELECT subsystem_code, app_type_code, companies, company_count
     FROM overlaps
     ORDER BY company_count DESC, subsystem_code
     LIMIT 10`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    subsystemCode: String(r.subsystem_code),
    appTypeCode: String(r.app_type_code),
    companies: String(r.companies),
    companyCount: Number(r.company_count),
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

export function formatCompanyOverlaps(rows: CompanyOverlapRow[]): string {
  if (rows.length === 0) return '_No competitive overlaps detected this week._';
  return rows
    .map(
      (r: CompanyOverlapRow) =>
        `- ${r.subsystemCode}-${r.appTypeCode}: ${r.companies} (${String(r.companyCount)} companies)`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateCompetitiveIntel(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query competitive overlaps
  log('info', 'Querying company overlaps for Competitive Intelligence...');
  const overlaps: CompanyOverlapRow[] = await queryCompanyOverlaps(
    conn,
    editionDate,
  );

  log(
    'info',
    `Found ${String(overlaps.length)} subsystem/type overlaps with multiple companies`,
  );

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperCompetitiveIntelSystemPrompt') as string) ||
    DEFAULT_COMPETITIVE_INTEL_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperCompetitiveIntelUserPrompt') as string) ||
    DEFAULT_COMPETITIVE_INTEL_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    companyOverlaps: formatCompanyOverlaps(overlaps),
  });

  // 3. Call inference
  log('info', `Generating Competitive Intelligence with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'Competitive Intelligence';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      overlaps: overlaps.map(
        (r: CompanyOverlapRow) =>
          `${r.subsystemCode}-${r.appTypeCode}: ${r.companies}`,
      ),
      overlapCount: overlaps.length,
      modelId,
    },
  };
}
