import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_FORECAST_SYSTEM_PROMPT,
  DEFAULT_FORECAST_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type SubsystemStat = {
  subsystemCode: string;
  weekCount: number;
  avgCount: number;
  changePct: number;
};

type CompanyActivityRow = {
  companyName: string;
  filingCount: number;
  filingTypes: string;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Compare this week's filing volume by subsystem against the 90-day average.
 */
export async function queryFilingStats(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<SubsystemStat[]> {
  const reader = await conn.runAndReadAll(
    `WITH this_week AS (
       SELECT subsystem_code, COUNT(*) AS cnt
       FROM filing
       WHERE date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
         AND date_filed <= CAST(? AS DATE)
         AND subsystem_code IS NOT NULL
       GROUP BY subsystem_code
     ),
     avg_90d AS (
       SELECT subsystem_code,
              COUNT(*) * 7.0 / 90.0 AS weekly_avg
       FROM filing
       WHERE date_filed >= CAST(? AS DATE) - INTERVAL 90 DAY
         AND date_filed <= CAST(? AS DATE)
         AND subsystem_code IS NOT NULL
       GROUP BY subsystem_code
     )
     SELECT tw.subsystem_code,
            tw.cnt AS week_count,
            COALESCE(a.weekly_avg, 0) AS avg_count,
            CASE WHEN COALESCE(a.weekly_avg, 0) > 0
              THEN ((tw.cnt - a.weekly_avg) / a.weekly_avg) * 100
              ELSE 0
            END AS change_pct
     FROM this_week tw
     LEFT JOIN avg_90d a ON a.subsystem_code = tw.subsystem_code
     ORDER BY tw.cnt DESC`,
    [editionDate, editionDate, editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    subsystemCode: String(r.subsystem_code),
    weekCount: Number(r.week_count),
    avgCount: Math.round(Number(r.avg_count) * 10) / 10,
    changePct: Math.round(Number(r.change_pct)),
  }));
}

/**
 * Get top companies by filing count this week, with their filing types.
 */
export async function queryCompanyActivity(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<CompanyActivityRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT c.name AS company_name,
            COUNT(*) AS filing_count,
            STRING_AGG(DISTINCT f.subsystem_code || '-' || f.app_type_code, ', '
                       ORDER BY f.subsystem_code || '-' || f.app_type_code) AS filing_types
     FROM filing f
     JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     JOIN company c ON c.id = ca.company_id
     WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
       AND f.date_filed <= CAST(? AS DATE)
       AND f.subsystem_code IS NOT NULL
       AND f.app_type_code IS NOT NULL
     GROUP BY c.name
     ORDER BY filing_count DESC
     LIMIT 5`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    companyName: String(r.company_name),
    filingCount: Number(r.filing_count),
    filingTypes: String(r.filing_types ?? ''),
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

export function formatFilingStats(stats: SubsystemStat[]): string {
  if (stats.length === 0) return '_No filing data available._';
  return stats
    .map(
      (s: SubsystemStat) =>
        `- ${s.subsystemCode}: ${String(s.weekCount)} this week (avg ${String(s.avgCount)}, ${s.changePct >= 0 ? '+' : ''}${String(s.changePct)}%)`,
    )
    .join('\n');
}

export function formatCompanyActivity(rows: CompanyActivityRow[]): string {
  if (rows.length === 0) return '_No company activity data._';
  return rows
    .map(
      (r: CompanyActivityRow) =>
        `- ${r.companyName}: ${String(r.filingCount)} filings (${r.filingTypes})`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateOrbitalForecast(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query filing volume stats
  log('info', 'Querying filing statistics for orbital forecast...');
  const stats: SubsystemStat[] = await queryFilingStats(conn, editionDate);
  const companyActivity: CompanyActivityRow[] = await queryCompanyActivity(
    conn,
    editionDate,
  );

  // 2. Identify notable trends (>30% change)
  const notableTrends: SubsystemStat[] = stats.filter(
    (s: SubsystemStat) => Math.abs(s.changePct) > 30,
  );
  log(
    'info',
    `Found ${String(notableTrends.length)} notable trends (>30% change)`,
  );

  // 3. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperForecastSystemPrompt') as string) ||
    DEFAULT_FORECAST_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperForecastUserPrompt') as string) ||
    DEFAULT_FORECAST_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    filingStats: formatFilingStats(stats),
    companyActivity: formatCompanyActivity(companyActivity),
  });

  // 4. Call inference
  log('info', `Generating orbital forecast with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'Orbital Forecast';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      stats,
      notableTrends: notableTrends.length,
      companyActivity: companyActivity.map(
        (r: CompanyActivityRow) => r.companyName,
      ),
      modelId,
    },
  };
}
