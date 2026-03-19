import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseFunction } from '../inference/inference-service.ts';
import type { RewrittenQuery } from './types.ts';

export const DEFAULT_REWRITE_SYSTEM_PROMPT: string = `You are a query rewriting assistant for an FCC filing search system.
Given a user question, produce 1–2 search queries as a JSON array of objects.

Each object has:
- "text": the rewritten search query string
- "filters" (optional): an object with any of:
  - "dateFrom": ISO date string (YYYY-MM-DD)
  - "dateTo": ISO date string (YYYY-MM-DD)
  - "subsystems": array of FCC subsystem codes (SAT, SES, SCL, ITC, etc.)
  - "company": company name to filter by
  - "docTypes": array of document types ("filing", "attachment", "pleading", "news")

Rules:
- Expand FCC acronyms: STA = Special Temporary Authority, LOA = Launch and Operate Authority, SAT = satellite, SES = earth station, etc.
- Normalize company name variants (e.g. "Hughes" -> "Hughes Network Systems")
- Decompose multi-part questions into separate queries
- Preserve file numbers verbatim (e.g. SAT-LOA-20040701-00011)
- Output ONLY the JSON array, no other text`;

export type RewriteResult = {
  queries: RewrittenQuery[];
  usage: { input: number; output: number };
};

/** Rewrite a user question into 1–2 structured search queries using an LLM. */
export async function rewriteQuery(
  question: string,
  backend: ConverseFunction,
  modelId: string,
  systemPrompt?: string,
): Promise<RewriteResult> {
  const prompt: string = systemPrompt || DEFAULT_REWRITE_SYSTEM_PROMPT;
  const input: ConverseCommandInput = {
    modelId,
    system: [{ text: prompt }],
    messages: [{ role: 'user', content: [{ text: question }] }],
    inferenceConfig: { maxTokens: 1024, temperature: 0 },
  };

  const response = await backend.converse(input);

  const rawText: string =
    response.output?.message?.content
      ?.filter((block) => block.text != null)
      .map((block) => block.text!)
      .join('') ?? '';

  const usage = {
    input: response.usage?.inputTokens ?? 0,
    output: response.usage?.outputTokens ?? 0,
  };

  const queries: RewrittenQuery[] = parseRewriteResponse(rawText, question);
  return { queries, usage };
}

/** Parse the JSON response, falling back to the original question on failure. */
function parseRewriteResponse(
  rawText: string,
  originalQuestion: string,
): RewrittenQuery[] {
  try {
    // Extract JSON array from response (model may wrap in markdown code block)
    const jsonMatch: RegExpMatchArray | null = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch == null) {
      return [{ text: originalQuestion }];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ text: originalQuestion }];
    }

    const queries: RewrittenQuery[] = [];
    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item != null &&
        typeof item.text === 'string'
      ) {
        const query: RewrittenQuery = { text: item.text };
        if (typeof item.filters === 'object' && item.filters != null) {
          query.filters = {};
          if (typeof item.filters.dateFrom === 'string')
            query.filters.dateFrom = item.filters.dateFrom;
          if (typeof item.filters.dateTo === 'string')
            query.filters.dateTo = item.filters.dateTo;
          if (Array.isArray(item.filters.subsystems))
            query.filters.subsystems = item.filters.subsystems.filter(
              (s: unknown) => typeof s === 'string',
            );
          if (typeof item.filters.company === 'string')
            query.filters.company = item.filters.company;
          if (Array.isArray(item.filters.docTypes))
            query.filters.docTypes = item.filters.docTypes.filter(
              (d: unknown) =>
                d === 'filing' ||
                d === 'attachment' ||
                d === 'pleading' ||
                d === 'news',
            );
        }
        queries.push(query);
      }
    }

    return queries.length > 0 ? queries : [{ text: originalQuestion }];
  } catch {
    return [{ text: originalQuestion }];
  }
}
