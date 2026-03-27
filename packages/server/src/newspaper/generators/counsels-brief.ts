import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_COUNSELS_BRIEF_SYSTEM_PROMPT,
  DEFAULT_COUNSELS_BRIEF_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import {
  queryWeeklyFilings,
  queryWeeklyNews,
  formatFilingTrends,
  formatNewsTrends,
  formatEditionDate,
} from './editorial.ts';

// ── Generator ───────────────────────────────────────────────────

export async function generateCounselsBrief(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query recent filings and news (reuse editorial queries)
  log('info', 'Querying weekly filings and news for counsel\'s brief...');
  const filings = await queryWeeklyFilings(conn, editionDate);
  const news = await queryWeeklyNews(conn, editionDate);
  log(
    'info',
    `Found ${String(filings.length)} filings and ${String(news.length)} news items`,
  );

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperCounselsBriefSystemPrompt') as string) ||
    DEFAULT_COUNSELS_BRIEF_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperCounselsBriefUserPrompt') as string) ||
    DEFAULT_COUNSELS_BRIEF_USER_PROMPT;

  const userPrompt: string = renderPrompt(userTemplate, {
    editionDate: formatEditionDate(editionDate),
    filingSummaries: formatFilingTrends(filings),
    newsSummaries: formatNewsTrends(news),
  });

  // 3. Call inference
  log('info', `Generating Counsel's Brief with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string =
    lines[0]?.replace(/^#+\s*/, '') ?? 'The Counsel\'s Brief';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      filingCount: filings.length,
      newsCount: news.length,
      modelId,
    },
  };
}
