import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_FILING_IN_FOCUS_SYSTEM_PROMPT,
  DEFAULT_FILING_IN_FOCUS_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type FocusFiling = {
  fileNumber: string;
  applicantName: string;
  subsystemCode: string;
  appTypeCode: string;
  dateFiled: string;
  summary: string;
  companyName: string;
  companyId: string;
  companyDescription: string;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Select one interesting recent filing for deep-dive coverage.
 * Prefers LOA/MOD/AMD filings from known companies with attachment summaries.
 */
export async function selectFocusFiling(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<FocusFiling | null> {
  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, f.address_attention AS applicant_name,
            f.subsystem_code, f.app_type_code,
            CAST(f.date_filed AS VARCHAR) AS date_filed,
            a.summary,
            c.name AS company_name, c.id AS company_id, c.description AS company_description
     FROM filing f
     JOIN attachment a ON a.filing_key = f.filing_key
     LEFT JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     LEFT JOIN company c ON c.id = ca.company_id
     WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 7 DAY
       AND f.date_filed <= CAST(? AS DATE)
       AND a.summary IS NOT NULL AND LENGTH(a.summary) > 50
       AND f.app_type_code NOT IN ('RWL', 'RPT')
       AND c.id IS NOT NULL
     ORDER BY
       CASE f.app_type_code
         WHEN 'LOA' THEN 1
         WHEN 'MOD' THEN 2
         WHEN 'AMD' THEN 3
         WHEN 'L/A' THEN 4
         ELSE 5
       END,
       f.date_filed DESC
     LIMIT 1`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  const rows = reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    fileNumber: String(r.file_number),
    applicantName: String(r.applicant_name),
    subsystemCode: String(r.subsystem_code),
    appTypeCode: String(r.app_type_code),
    dateFiled: String(r.date_filed),
    summary: String(r.summary),
    companyName: String(r.company_name),
    companyId: String(r.company_id),
    companyDescription: String(r.company_description ?? ''),
  }));

  return rows[0] ?? null;
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

export function formatFilingType(filing: FocusFiling): string {
  return `${filing.subsystemCode}-${filing.appTypeCode}`;
}

// ── Generator ───────────────────────────────────────────────────

export async function generateFilingInFocus(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Select a focus filing
  log('info', 'Selecting focus filing for Filing in Focus...');
  const filing: FocusFiling | null = await selectFocusFiling(conn, editionDate);

  if (!filing) {
    log('info', 'No suitable filing found for Filing in Focus');
    return {
      headline: 'Filing in Focus',
      body: "_No suitable filing for today's focus._",
      sourceData: { noData: true },
    };
  }

  log(
    'info',
    `Selected filing ${filing.fileNumber} from ${filing.companyName}`,
  );

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperFilingInFocusSystemPrompt') as string) ||
    DEFAULT_FILING_IN_FOCUS_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperFilingInFocusUserPrompt') as string) ||
    DEFAULT_FILING_IN_FOCUS_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    fileNumber: filing.fileNumber,
    applicantName: filing.applicantName,
    filingType: formatFilingType(filing),
    filingSummary: filing.summary,
    companyDescription:
      filing.companyDescription || 'No description available.',
  });

  // 3. Call inference
  log('info', `Generating Filing in Focus with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? 'Filing in Focus';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      fileNumber: filing.fileNumber,
      companyName: filing.companyName,
      companyId: filing.companyId,
      filingType: formatFilingType(filing),
      dateFiled: filing.dateFiled,
      modelId,
    },
  };
}
