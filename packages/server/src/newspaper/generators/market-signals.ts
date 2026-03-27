import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { renderPrompt } from '../../inference/prompts.ts';
import {
  DEFAULT_MARKET_SIGNALS_SYSTEM_PROMPT,
  DEFAULT_MARKET_SIGNALS_USER_PROMPT,
} from '../prompts.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import {
  formatEditionDate,
  formatFilingTrends,
  formatNewsTrends,
  queryWeeklyFilings,
  queryWeeklyNews,
} from './editorial.ts';

// ── Data types for query results ────────────────────────────────

type OwnershipEvent = {
  eventType: string;
  effectiveDate: string;
  acquirerName: string;
  targetName: string;
  sourceReference: string;
  notes: string;
};

// ── Query helpers ───────────────────────────────────────────────

export async function queryRecentOwnershipEvents(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<OwnershipEvent[]> {
  const reader = await conn.runAndReadAll(
    `SELECT oe.event_type,
            CAST(oe.effective_date AS VARCHAR) AS effective_date,
            acquirer.name AS acquirer_name,
            target.name AS target_name,
            oe.source_reference,
            oe.notes
     FROM ownership_event oe
     JOIN company acquirer ON acquirer.id = oe.acquirer_company_id
     JOIN company target ON target.id = oe.target_company_id
     WHERE oe.effective_date >= CAST(? AS DATE) - INTERVAL 90 DAY
       AND oe.effective_date <= CAST(? AS DATE)
     ORDER BY oe.effective_date DESC
     LIMIT 5`,
    [editionDate, editionDate] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
    eventType: String(r.event_type),
    effectiveDate: String(r.effective_date ?? ''),
    acquirerName: String(r.acquirer_name),
    targetName: String(r.target_name),
    sourceReference: String(r.source_reference ?? ''),
    notes: String(r.notes ?? ''),
  }));
}

// ── Formatters ──────────────────────────────────────────────────

function formatOwnershipEvents(events: OwnershipEvent[]): string {
  if (events.length === 0) return '_No recent ownership events._';
  return events
    .map(
      (e: OwnershipEvent) =>
        `- ${e.acquirerName} ${e.eventType} ${e.targetName} (${e.effectiveDate})${e.notes ? ': ' + e.notes : ''}`,
    )
    .join('\n');
}

// ── Generator ───────────────────────────────────────────────────

export async function generateMarketSignals(
  opts: GenerateOptions,
): Promise<GeneratorResult> {
  const { conn, editionDate, inferenceService, config, log } = opts;

  // 1. Query ownership events, filings, and news
  log(
    'info',
    'Querying ownership events, filings, and news for market signals...',
  );
  const ownershipEvents: OwnershipEvent[] = await queryRecentOwnershipEvents(
    conn,
    editionDate,
  );
  const filings = await queryWeeklyFilings(conn, editionDate);
  const news = await queryWeeklyNews(conn, editionDate);

  // 2. Build prompt
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemTemplate: string =
    (config.get('newspaperMarketSignalsSystemPrompt') as string) ||
    DEFAULT_MARKET_SIGNALS_SYSTEM_PROMPT;
  const userTemplate: string =
    (config.get('newspaperMarketSignalsUserPrompt') as string) ||
    DEFAULT_MARKET_SIGNALS_USER_PROMPT;

  const vars: Record<string, string> = {
    editionDate: formatEditionDate(editionDate),
    ownershipEvents: formatOwnershipEvents(ownershipEvents),
    filingSummaries: formatFilingTrends(filings),
    newsSummaries: formatNewsTrends(news),
  };

  const systemPrompt: string = renderPrompt(systemTemplate, vars);
  const userPrompt: string = renderPrompt(userTemplate, vars);

  // 3. Call inference
  log('info', `Generating market signals with ${modelId}...`);
  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt },
  });

  // 4. Parse response
  const lines: string[] = response.content.split('\n');
  const headline: string = lines[0]?.replace(/^#+\s*/, '') ?? 'Market Signals';
  const body: string = response.content;

  return {
    headline,
    body,
    sourceData: {
      ownershipEventCount: ownershipEvents.length,
      filingCount: filings.length,
      newsCount: news.length,
      modelId,
    },
  };
}
