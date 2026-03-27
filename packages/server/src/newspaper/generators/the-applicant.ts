import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_APPLICANT_SYSTEM_PROMPT,
  DEFAULT_APPLICANT_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import {
  queryCompanyFilings,
  queryCompanyAliases,
  formatCompanyFilings,
} from './company-spotlight.ts';

// ── Data types ──────────────────────────────────────────────────

type ApplicantCompany = {
  id: number;
  name: string;
  description: string | null;
  parentName: string | null;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Select a lower-profile company for "The Applicant" column:
 * - Exclude companies profiled as company_spotlight or the_applicant in the last 56 days
 * - Require at least 1 filing in the last 90 days
 * - Prefer less active companies (ORDER BY recent_filings ASC)
 */
export async function selectApplicantCompany(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<ApplicantCompany | null> {
  const reader = await conn.runAndReadAll(
    `WITH recently_profiled AS (
       SELECT DISTINCT JSON_EXTRACT_STRING(na.source_data, '$.companyId') AS company_id
       FROM newspaper_article na
       WHERE na.content_type IN ('company_spotlight', 'the_applicant')
         AND na.created_at >= CAST(? AS TIMESTAMP) - INTERVAL 56 DAY
         AND JSON_EXTRACT_STRING(na.source_data, '$.companyId') IS NOT NULL
     ),
     active_companies AS (
       SELECT c.id, c.name, c.description, c.parent_company_id,
              COUNT(f.filing_key) AS recent_filings
       FROM company c
       JOIN company_alias ca ON ca.company_id = c.id
       JOIN filing f ON UPPER(f.address_attention) = UPPER(ca.alias_name)
       WHERE f.date_filed >= CAST(? AS DATE) - INTERVAL 90 DAY
         AND f.date_filed <= CAST(? AS DATE)
       GROUP BY c.id, c.name, c.description, c.parent_company_id
       HAVING COUNT(f.filing_key) >= 1
     )
     SELECT ac.id, ac.name, ac.description, ac.parent_company_id,
            pc.name AS parent_name
     FROM active_companies ac
     LEFT JOIN company pc ON pc.id = ac.parent_company_id
     WHERE CAST(ac.id AS VARCHAR) NOT IN (
       SELECT company_id FROM recently_profiled WHERE company_id IS NOT NULL
     )
     ORDER BY ac.recent_filings ASC
     LIMIT 1`,
    [editionDate, editionDate, editionDate] as DuckDBValue[],
  );

  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: Number(r.id),
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    parentName: r.parent_name != null ? String(r.parent_name) : null,
  };
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

// ── Generator ───────────────────────────────────────────────────

export async function generateTheApplicant(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Select this week's applicant company
  log('info', 'Selecting applicant company...');
  const company: ApplicantCompany | null = await selectApplicantCompany(
    conn,
    editionDate,
  );

  if (company == null) {
    return {
      headline: 'The Applicant',
      body: '_No eligible company for The Applicant this week._',
      sourceData: { companyId: null },
    };
  }

  log('info', `Applicant company: ${company.name} (id=${String(company.id)})`);

  // 2. Query company data
  const filings = await queryCompanyFilings(conn, company.id, editionDate);
  const aliases: string[] = await queryCompanyAliases(conn, company.id);

  // 3. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperApplicantSystemPrompt') as string) ||
    DEFAULT_APPLICANT_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperApplicantUserPrompt') as string) ||
    DEFAULT_APPLICANT_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    companyName: company.name,
    companyId: String(company.id),
    companyDescription: company.description ?? 'No description available.',
    parentCompany: company.parentName ?? 'None',
    aliases: aliases.length > 0 ? aliases.join('; ') : 'None',
    recentFilings: formatCompanyFilings(filings),
  });

  // 4. Call inference
  log('info', `Generating The Applicant with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? `The Applicant: ${company.name}`;
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      companyId: company.id,
      companyName: company.name,
      filingCount: filings.length,
      modelId,
    },
  };
}
