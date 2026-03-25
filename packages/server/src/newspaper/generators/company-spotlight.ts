import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_SPOTLIGHT_SYSTEM_PROMPT,
  DEFAULT_SPOTLIGHT_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

// ── Data types ──────────────────────────────────────────────────

type SpotlightCompany = {
  id: number;
  name: string;
  description: string | null;
  parentName: string | null;
};

type CompanyFiling = {
  fileNumber: string;
  dateFiled: string;
  summary: string;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Select this week's spotlight company:
 * - Ordered by recent filing count (most active first)
 * - Skip companies spotlighted in the last 8 weeks
 */
export async function selectSpotlightCompany(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<SpotlightCompany | null> {
  const reader = await conn.runAndReadAll(
    `WITH recently_spotlighted AS (
       SELECT DISTINCT JSON_EXTRACT_STRING(na.source_data, '$.companyId') AS company_id
       FROM newspaper_article na
       WHERE na.content_type = 'company_spotlight'
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
       GROUP BY c.id, c.name, c.description, c.parent_company_id
     )
     SELECT ac.id, ac.name, ac.description, ac.parent_company_id,
            pc.name AS parent_name
     FROM active_companies ac
     LEFT JOIN company pc ON pc.id = ac.parent_company_id
     WHERE CAST(ac.id AS VARCHAR) NOT IN (
       SELECT company_id FROM recently_spotlighted WHERE company_id IS NOT NULL
     )
     ORDER BY ac.recent_filings DESC
     LIMIT 1`,
    [editionDate, editionDate] as DuckDBValue[],
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

export async function queryCompanyFilings(
  conn: DuckDBConnection,
  companyId: number,
  editionDate: string,
): Promise<CompanyFiling[]> {
  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, CAST(f.date_filed AS VARCHAR) AS date_filed,
            COALESCE(a.summary, '') AS summary
     FROM filing f
     JOIN company_alias ca ON UPPER(f.address_attention) = UPPER(ca.alias_name)
     LEFT JOIN attachment a ON a.filing_key = f.filing_key AND a.summary IS NOT NULL
     WHERE ca.company_id = ?
       AND f.date_filed >= CAST(? AS DATE) - INTERVAL 90 DAY
     ORDER BY f.date_filed DESC
     LIMIT 10`,
    [companyId, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    fileNumber: String(r.file_number),
    dateFiled: String(r.date_filed ?? ''),
    summary: String(r.summary),
  }));
}

export async function queryCompanyAliases(
  conn: DuckDBConnection,
  companyId: number,
): Promise<string[]> {
  const reader = await conn.runAndReadAll(
    `SELECT alias_name FROM company_alias WHERE company_id = ? LIMIT 10`,
    [companyId] as DuckDBValue[],
  );
  return reader
    .getRowObjectsJS()
    .map((r: Record<string, unknown>) => String(r.alias_name));
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

export function formatCompanyFilings(filings: CompanyFiling[]): string {
  if (filings.length === 0) return '_No recent filings._';
  return filings
    .map(
      (f: CompanyFiling) =>
        `- ${f.fileNumber} (${f.dateFiled})${f.summary ? ': ' + f.summary.slice(0, 150) : ''}`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateCompanySpotlight(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Select this week's company
  log('info', 'Selecting spotlight company...');
  const company: SpotlightCompany | null = await selectSpotlightCompany(
    conn,
    editionDate,
  );

  if (company == null) {
    return {
      headline: 'Company Spotlight',
      body: '_No eligible company for spotlight this week._',
      sourceData: { companyId: null },
    };
  }

  log('info', `Spotlight company: ${company.name} (id=${String(company.id)})`);

  // 2. Query company data
  const filings: CompanyFiling[] = await queryCompanyFilings(
    conn,
    company.id,
    editionDate,
  );
  const aliases: string[] = await queryCompanyAliases(conn, company.id);

  // 3. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperSpotlightSystemPrompt') as string) ||
    DEFAULT_SPOTLIGHT_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperSpotlightUserPrompt') as string) ||
    DEFAULT_SPOTLIGHT_USER_PROMPT;

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
  log('info', `Generating company spotlight with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response — extract CEO name from last line if present
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? `Spotlight: ${company.name}`;

  let ceoName: string | null = null;
  let body: string = response.content;
  const lastLine: string = lines[lines.length - 1]?.trim() ?? '';
  const ceoMatch: RegExpMatchArray | null = lastLine.match(/^CEO:\s*(.+)$/i);
  if (ceoMatch) {
    const parsed: string = ceoMatch[1]!.trim();
    if (parsed.toLowerCase() !== 'unknown') {
      ceoName = parsed;
    }
    // Strip the CEO line from the article body
    body = lines.slice(0, -1).join('\n').trimEnd();
  }

  return {
    headline,
    body,
    sourceData: {
      companyId: company.id,
      companyName: company.name,
      ceoName,
      filingCount: filings.length,
      modelId,
    },
  };
}
