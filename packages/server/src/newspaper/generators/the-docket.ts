import { renderPrompt } from '../../inference/prompts.ts';
import { lastBusinessDayBefore } from '../../stats/business-day.ts';
import { getRecentFilings } from '../../stats/repository.ts';
import type { RecentFiling } from '../../stats/types.ts';
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

// ── Aggregators ─────────────────────────────────────────────────

/** Group filings by subsystem code, descending by count. */
export function aggregateBySubsystem(
  filings: ReadonlyArray<RecentFiling>,
): SubsystemCount[] {
  const counts: Map<string, number> = new Map();
  for (const f of filings) {
    counts.set(f.subsystem_code, (counts.get(f.subsystem_code) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([subsystemCode, count]: [string, number]) => ({
      subsystemCode,
      count,
    }))
    .sort((a: SubsystemCount, b: SubsystemCount) => b.count - a.count);
}

/**
 * Group filings by applicant, descending by count. Uses `company_name` when
 * present (matching the "Company" column in Yesterday's Filings), falling
 * back to `address_attention` (the raw "Applicant" string on the filing)
 * for un-linked filings. Returns the top 5.
 */
export function aggregateTopApplicants(
  filings: ReadonlyArray<RecentFiling>,
): TopApplicant[] {
  const counts: Map<string, number> = new Map();
  for (const f of filings) {
    const name: string | null = f.company_name ?? f.address_attention;
    if (name == null || name.length === 0) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([companyName, filingCount]: [string, number]) => ({
      companyName,
      filingCount,
    }))
    .sort((a: TopApplicant, b: TopApplicant) => b.filingCount - a.filingCount)
    .slice(0, 5);
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

/**
 * Render the raw filing list as a markdown bullet list. This is the same
 * data the reader sees in the "Yesterday's Filings" table — giving it to
 * the LLM lets the column reference specific file numbers, applicants,
 * and statuses instead of only aggregate counts.
 */
export function formatFilingSummaries(
  filings: ReadonlyArray<RecentFiling>,
): string {
  if (filings.length === 0) return '_No filings recorded._';
  return filings
    .map((f: RecentFiling) => {
      const applicant: string =
        f.company_name ?? f.address_attention ?? 'Unknown applicant';
      const type: string = `${f.subsystem_code}-${f.app_type_code}`;
      const status: string = f.status_code ?? 'Unknown status';
      return `- ${f.file_number} (${type}) — ${applicant} [${status}]`;
    })
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateTheDocket(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query the same row set the reader sees in "Yesterday's Filings".
  const targetDate: string = lastBusinessDayBefore(editionDate);
  log(
    'info',
    `Querying The Docket filings for ${targetDate} (edition ${editionDate})...`,
  );
  const filings: RecentFiling[] = await getRecentFilings(conn, targetDate);
  log('info', `Found ${String(filings.length)} filings for ${targetDate}`);

  // 2. Derive aggregates in JS from that single source of truth.
  const filingsBySubsystem: SubsystemCount[] = aggregateBySubsystem(filings);
  const topApplicants: TopApplicant[] = aggregateTopApplicants(filings);

  // 3. Build prompt
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
    filingSummaries: formatFilingSummaries(filings),
  });

  // 4. Call inference
  log('info', `Generating The Docket with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? 'The Docket';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      targetDate,
      filingCount: filings.length,
      filingsBySubsystem: filingsBySubsystem.map(
        (r: SubsystemCount) => `${r.subsystemCode}: ${String(r.count)}`,
      ),
      topApplicants: topApplicants.map((r: TopApplicant) => r.companyName),
      fileNumbers: filings.map((f: RecentFiling) => f.file_number),
      modelId,
    },
  };
}
