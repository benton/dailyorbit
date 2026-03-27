import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_SPECTRUM_WATCH_SYSTEM_PROMPT,
  DEFAULT_SPECTRUM_WATCH_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type SubsystemBreakdownRow = {
  subsystemCode: string;
  weekCount: number;
  avgCount: number;
  changePct: number;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Compare this week's filing volume by subsystem against the 90-day average.
 */
export async function querySubsystemBreakdown(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<SubsystemBreakdownRow[]> {
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

export function formatSubsystemBreakdown(
  rows: SubsystemBreakdownRow[],
): string {
  if (rows.length === 0) return '_No filing data available._';
  return rows
    .map(
      (r: SubsystemBreakdownRow) =>
        `- ${r.subsystemCode}: ${String(r.weekCount)} this week (avg ${String(r.avgCount)}, ${r.changePct >= 0 ? '+' : ''}${String(r.changePct)}%)`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateSpectrumWatch(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query subsystem breakdown
  log('info', 'Querying subsystem breakdown for Spectrum Watch...');
  const breakdown: SubsystemBreakdownRow[] = await querySubsystemBreakdown(
    conn,
    editionDate,
  );

  const notableTrends: SubsystemBreakdownRow[] = breakdown.filter(
    (r: SubsystemBreakdownRow) => Math.abs(r.changePct) > 30,
  );
  log(
    'info',
    `Found ${String(breakdown.length)} subsystems, ${String(notableTrends.length)} notable trends (>30% change)`,
  );

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperSpectrumWatchSystemPrompt') as string) ||
    DEFAULT_SPECTRUM_WATCH_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperSpectrumWatchUserPrompt') as string) ||
    DEFAULT_SPECTRUM_WATCH_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    subsystemBreakdown: formatSubsystemBreakdown(breakdown),
  });

  // 3. Call inference
  log('info', `Generating Spectrum Watch with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? 'Spectrum Watch';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      breakdown: breakdown.map(
        (r: SubsystemBreakdownRow) =>
          `${r.subsystemCode}: ${String(r.weekCount)} (${r.changePct >= 0 ? '+' : ''}${String(r.changePct)}%)`,
      ),
      notableTrends: notableTrends.length,
      modelId,
    },
  };
}
