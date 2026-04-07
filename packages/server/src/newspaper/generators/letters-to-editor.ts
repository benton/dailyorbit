import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_LETTERS_SYSTEM_PROMPT,
  DEFAULT_LETTERS_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import { formatEditionDate } from './editorial.ts';

// ── Data types for query results ────────────────────────────────

type PreviousEditionContent = {
  contentType: string;
  body: string;
};

// ── Query helpers ───────────────────────────────────────────────

/**
 * Pull content from the most recent edition strictly before `editionDate`.
 * Using a subquery (rather than `editionDate - 1 day`) means the column
 * still works if there was a gap in publishing — and, more importantly,
 * if the letters slot ever moves to a day where "yesterday" would be a
 * weekend with no edition at all.
 */
export async function queryPreviousEditionContent(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<PreviousEditionContent[]> {
  const reader = await conn.runAndReadAll(
    `SELECT na.content_type, na.body
     FROM newspaper_article na
     JOIN newspaper_edition ne ON ne.id = na.edition_id
     WHERE ne.edition_date = (
       SELECT MAX(edition_date) FROM newspaper_edition
       WHERE edition_date < CAST(? AS DATE)
     )
       AND na.content_type IN ('daily_digest', 'editorial', 'counsels_brief', 'letters_to_editor', 'market_signals', 'press_gallery')
       AND na.status = 'generated'
     ORDER BY na.display_order`,
    [editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    contentType: String(r.content_type),
    body: String(r.body),
  }));
}

// ── Formatters ──────────────────────────────────────────────────

function formatPreviousContent(
  articles: PreviousEditionContent[],
  contentType: string,
): string {
  const match: PreviousEditionContent | undefined = articles.find(
    (a: PreviousEditionContent) => a.contentType === contentType,
  );
  if (!match) return '_No content from previous edition._';
  return match.body.slice(0, 500);
}

// ── Generator ───────────────────────────────────────────────────

export async function generateLettersToEditor(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query previous edition content
  log('info', 'Querying previous edition content for letters...');
  const previousContent: PreviousEditionContent[] =
    await queryPreviousEditionContent(conn, editionDate);

  // 2. Extract relevant content
  const previousDigest: string = formatPreviousContent(
    previousContent,
    'daily_digest',
  );
  const previousEditorial: string =
    formatPreviousContent(previousContent, 'editorial') !==
    '_No content from previous edition._'
      ? formatPreviousContent(previousContent, 'editorial')
      : formatPreviousContent(previousContent, 'counsels_brief');

  // 3. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemTemplate: string =
    (config.get('newspaperLettersSystemPrompt') as string) ||
    DEFAULT_LETTERS_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperLettersUserPrompt') as string) ||
    DEFAULT_LETTERS_USER_PROMPT;

  const vars: Record<string, string> = {
    editionDate: formatEditionDate(editionDate),
    previousDigest,
    previousEditorial,
  };

  const systemPrompt: string = renderPrompt(systemTemplate, vars);
  const userPrompt: string = renderPrompt(userTemplate, vars);

  // 4. Call inference
  log('info', `Generating letters to editor with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 5. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'Letters to the Editor';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      previousContentCount: previousContent.length,
      hasDigest: previousContent.some(
        (a: PreviousEditionContent) => a.contentType === 'daily_digest',
      ),
      hasEditorial: previousContent.some(
        (a: PreviousEditionContent) =>
          a.contentType === 'editorial' || a.contentType === 'counsels_brief',
      ),
      modelId,
    },
  };
}
