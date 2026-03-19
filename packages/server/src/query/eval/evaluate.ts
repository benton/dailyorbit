import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockClient } from '../../inference/bedrock-client.ts';
import type { EmbeddingContext } from '../../search/content-search.ts';
import { rewriteQuery } from '../rewrite.ts';
import { retrieveContext } from '../retrieve.ts';
import { generateAnswer } from '../generate.ts';
import type { RetrievedSource, QuerySSEEvent } from '../types.ts';

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

export type EvalCase = {
  id: string;
  category: string;
  question: string;
  expected_sources: string[];
  notes: string;
};

export type EvalResult = {
  id: string;
  category: string;
  question: string;
  recall: number;
  reciprocalRank: number;
  faithfulness: number;
  completeness: number;
  retrievedIds: string[];
  answerPreview: string;
  latencyMs: number;
  error?: string;
};

export type EvalSummary = {
  totalCases: number;
  meanRecall: number;
  meanReciprocalRank: number;
  meanFaithfulness: number;
  meanCompleteness: number;
  byCategory: Record<
    string,
    {
      count: number;
      meanRecall: number;
      meanReciprocalRank: number;
      meanFaithfulness: number;
      meanCompleteness: number;
    }
  >;
  failures: EvalResult[];
  results: EvalResult[];
};

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

const DEFAULT_DATASET_PATH: string = resolve(
  import.meta.dirname ?? '.',
  'dataset.json',
);

export function loadDataset(datasetPath?: string): EvalCase[] {
  const path: string = datasetPath ?? DEFAULT_DATASET_PATH;
  const raw: string = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in dataset file: ${path}`);
  }
  return parsed as EvalCase[];
}

// ---------------------------------------------------------------------------
// Source matching
// ---------------------------------------------------------------------------

/**
 * Check if a retrieved source ID matches an expected source pattern.
 * Supports glob-like patterns with '*' wildcard.
 */
function sourceMatches(retrievedId: string, pattern: string): boolean {
  // Strip "news:" prefix for news pattern matching
  const cleanPattern: string = pattern.startsWith('news:')
    ? pattern.slice(5)
    : pattern;

  if (!cleanPattern.includes('*')) {
    return retrievedId === cleanPattern;
  }

  // Convert glob to regex: escape special chars, replace * with .*
  const regexStr: string = cleanPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`, 'i').test(retrievedId);
}

/**
 * Compute Recall@K: fraction of expected sources found in retrieved sources.
 * For "should-decline" cases (empty expected_sources), recall is 1.0 if
 * the retrieved set is also empty or the answer indicates insufficient data.
 */
function computeRecall(
  retrievedSources: RetrievedSource[],
  expectedPatterns: string[],
): number {
  if (expectedPatterns.length === 0) {
    // should-decline: recall = 1 always (we evaluate via faithfulness instead)
    return 1.0;
  }

  let found: number = 0;
  for (const pattern of expectedPatterns) {
    const isNewsPattern: boolean = pattern.startsWith('news:');
    const matched: boolean = retrievedSources.some((src) => {
      const checkId: string =
        isNewsPattern || src.type === 'news'
          ? `${src.title} ${src.id}`
          : src.id;
      return sourceMatches(checkId, pattern) || sourceMatches(src.id, pattern);
    });
    if (matched) found++;
  }

  return found / expectedPatterns.length;
}

/**
 * Compute Mean Reciprocal Rank: 1/rank of the first relevant result.
 */
function computeMRR(
  retrievedSources: RetrievedSource[],
  expectedPatterns: string[],
): number {
  if (expectedPatterns.length === 0) return 1.0;

  for (let i = 0; i < retrievedSources.length; i++) {
    const src: RetrievedSource = retrievedSources[i]!;
    for (const pattern of expectedPatterns) {
      const isNewsPattern: boolean = pattern.startsWith('news:');
      const checkId: string =
        isNewsPattern || src.type === 'news'
          ? `${src.title} ${src.id}`
          : src.id;
      if (sourceMatches(checkId, pattern) || sourceMatches(src.id, pattern)) {
        return 1 / (i + 1);
      }
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// LLM-as-judge
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT: string = `You are an impartial evaluator assessing the quality of answers generated by an FCC filing analysis system.

You will be given:
1. The original question
2. The retrieved source snippets
3. The generated answer

Score the answer on two dimensions (1-5 each):

**Faithfulness** (1-5): Does the answer only make claims supported by the provided sources?
- 5: Every claim is directly supported by sources, with proper citations
- 3: Mostly supported, but some minor claims lack source backing
- 1: Contains significant unsupported claims or hallucinations

**Completeness** (1-5): Does the answer adequately address the user's question given the available sources?
- 5: Thoroughly addresses the question using all relevant sources
- 3: Partially addresses the question, missing some relevant information from sources
- 1: Fails to meaningfully address the question

For "should-decline" questions (off-topic or outside corpus scope):
- Faithfulness 5 if the system correctly declines to answer
- Completeness 5 if the system explains it cannot answer from available sources

Respond ONLY with a JSON object: {"faithfulness": N, "completeness": N}`;

async function judgeAnswer(
  question: string,
  sources: RetrievedSource[],
  answer: string,
  client: BedrockClient,
  modelId: string,
): Promise<{ faithfulness: number; completeness: number }> {
  const sourcesText: string = sources
    .map(
      (s, i) =>
        `[Source ${i + 1}: ${s.type} — ${s.id}]\nTitle: ${s.title}\n${s.snippet}`,
    )
    .join('\n\n');

  const userMessage: string = `Question: ${question}\n\nRetrieved Sources:\n${sourcesText}\n\nGenerated Answer:\n${answer}`;

  const input: ConverseCommandInput = {
    modelId,
    system: [{ text: JUDGE_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0 },
  };

  const response = await client.converse(input);
  const rawText: string =
    response.output?.message?.content
      ?.filter((block) => block.text != null)
      .map((block) => block.text!)
      .join('') ?? '';

  try {
    const jsonMatch: RegExpMatchArray | null = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch == null) return { faithfulness: 3, completeness: 3 };
    const parsed = JSON.parse(jsonMatch[0]) as {
      faithfulness: number;
      completeness: number;
    };
    return {
      faithfulness: Math.max(1, Math.min(5, Math.round(parsed.faithfulness))),
      completeness: Math.max(1, Math.min(5, Math.round(parsed.completeness))),
    };
  } catch {
    return { faithfulness: 3, completeness: 3 };
  }
}

// ---------------------------------------------------------------------------
// Single-case evaluation
// ---------------------------------------------------------------------------

async function evaluateCase(
  evalCase: EvalCase,
  conn: DuckDBConnection,
  client: BedrockClient,
  rewriteModelId: string,
  generateModelId: string,
  judgeModelId: string,
  embeddingCtx: EmbeddingContext | undefined,
  verbose: boolean,
): Promise<EvalResult> {
  const start: number = performance.now();

  try {
    // 1. Rewrite
    const { queries } = await rewriteQuery(
      evalCase.question,
      client,
      rewriteModelId,
    );
    if (verbose) {
      console.log(
        `  Rewritten into ${queries.length} queries: ${queries.map((q) => q.text).join(' | ')}`,
      );
    }

    // 2. Retrieve
    const { sources } = await retrieveContext(queries, conn, embeddingCtx);
    if (verbose) {
      console.log(
        `  Retrieved ${sources.length} sources: ${sources.map((s) => `${s.type}:${s.id}`).join(', ')}`,
      );
    }

    // 3. Compute retrieval metrics
    const recall: number = computeRecall(sources, evalCase.expected_sources);
    const reciprocalRank: number = computeMRR(
      sources,
      evalCase.expected_sources,
    );

    // 4. Generate answer
    let answerText: string = '';
    const gen = generateAnswer(evalCase.question, sources, client, generateModelId);
    let result = await gen.next();
    while (!result.done) {
      const event: QuerySSEEvent = result.value;
      if (event.type === 'delta') {
        answerText += event.text;
      }
      result = await gen.next();
    }

    if (verbose) {
      console.log(
        `  Answer preview: ${answerText.slice(0, 120)}${answerText.length > 120 ? '...' : ''}`,
      );
    }

    // 5. LLM-as-judge
    const { faithfulness, completeness } = await judgeAnswer(
      evalCase.question,
      sources,
      answerText,
      client,
      judgeModelId,
    );

    const latencyMs: number = Math.round(performance.now() - start);

    return {
      id: evalCase.id,
      category: evalCase.category,
      question: evalCase.question,
      recall,
      reciprocalRank,
      faithfulness,
      completeness,
      retrievedIds: sources.map((s) => `${s.type}:${s.id}`),
      answerPreview: answerText.slice(0, 300),
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs: number = Math.round(performance.now() - start);
    const errorMsg: string =
      err instanceof Error ? err.message : String(err);
    return {
      id: evalCase.id,
      category: evalCase.category,
      question: evalCase.question,
      recall: 0,
      reciprocalRank: 0,
      faithfulness: 0,
      completeness: 0,
      retrievedIds: [],
      answerPreview: '',
      latencyMs,
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Main evaluation runner
// ---------------------------------------------------------------------------

export type EvalOptions = {
  datasetPath?: string | undefined;
  rewriteModelId?: string | undefined;
  generateModelId?: string | undefined;
  judgeModelId?: string | undefined;
  verbose?: boolean | undefined;
};

export async function runEvaluation(
  conn: DuckDBConnection,
  client: BedrockClient,
  embeddingCtx: EmbeddingContext | undefined,
  options: EvalOptions = {},
): Promise<EvalSummary> {
  const dataset: EvalCase[] = loadDataset(options.datasetPath);
  const rewriteModelId: string =
    options.rewriteModelId ?? 'us.amazon.nova-micro-v1:0';
  const generateModelId: string =
    options.generateModelId ?? 'us.amazon.nova-pro-v1:0';
  const judgeModelId: string =
    options.judgeModelId ?? 'us.amazon.nova-pro-v1:0';
  const verbose: boolean = options.verbose ?? false;

  console.log(
    `Running evaluation: ${dataset.length} cases, rewrite=${rewriteModelId}, generate=${generateModelId}, judge=${judgeModelId}`,
  );
  console.log('---');

  const results: EvalResult[] = [];

  for (const evalCase of dataset) {
    console.log(`[${evalCase.id}] ${evalCase.question}`);
    const result: EvalResult = await evaluateCase(
      evalCase,
      conn,
      client,
      rewriteModelId,
      generateModelId,
      judgeModelId,
      embeddingCtx,
      verbose,
    );
    results.push(result);

    const status: string = result.error != null ? 'ERROR' : 'OK';
    console.log(
      `  ${status} — recall=${result.recall.toFixed(2)} mrr=${result.reciprocalRank.toFixed(2)} ` +
        `faith=${result.faithfulness} complete=${result.completeness} (${result.latencyMs}ms)`,
    );
    if (result.error != null) {
      console.log(`  Error: ${result.error}`);
    }
  }

  // Aggregate
  const totalCases: number = results.length;
  const meanRecall: number = mean(results.map((r) => r.recall));
  const meanReciprocalRank: number = mean(
    results.map((r) => r.reciprocalRank),
  );
  const meanFaithfulness: number = mean(results.map((r) => r.faithfulness));
  const meanCompleteness: number = mean(results.map((r) => r.completeness));

  // Per-category breakdown
  const byCategory: EvalSummary['byCategory'] = {};
  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults: EvalResult[] = results.filter((r) => r.category === cat);
    byCategory[cat] = {
      count: catResults.length,
      meanRecall: mean(catResults.map((r) => r.recall)),
      meanReciprocalRank: mean(catResults.map((r) => r.reciprocalRank)),
      meanFaithfulness: mean(catResults.map((r) => r.faithfulness)),
      meanCompleteness: mean(catResults.map((r) => r.completeness)),
    };
  }

  // Failures: low recall or low faithfulness
  const failures: EvalResult[] = results.filter(
    (r) => r.recall < 0.5 || r.faithfulness <= 2 || r.error != null,
  );

  return {
    totalCases,
    meanRecall,
    meanReciprocalRank,
    meanFaithfulness,
    meanCompleteness,
    byCategory,
    failures,
    results,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

export function printSummary(summary: EvalSummary): void {
  console.log('\n' + '='.repeat(60));
  console.log('EVALUATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total cases: ${summary.totalCases}`);
  console.log(`Mean Recall@10:          ${summary.meanRecall.toFixed(3)}`);
  console.log(
    `Mean Reciprocal Rank:    ${summary.meanReciprocalRank.toFixed(3)}`,
  );
  console.log(
    `Mean Faithfulness (1-5): ${summary.meanFaithfulness.toFixed(2)}`,
  );
  console.log(
    `Mean Completeness (1-5): ${summary.meanCompleteness.toFixed(2)}`,
  );

  console.log('\nPer-category breakdown:');
  console.log(
    '  Category                    | Count | Recall | MRR    | Faith | Compl',
  );
  console.log('  ' + '-'.repeat(73));
  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    console.log(
      `  ${cat.padEnd(29)} | ${String(stats.count).padStart(5)} | ${stats.meanRecall.toFixed(3).padStart(6)} | ${stats.meanReciprocalRank.toFixed(3).padStart(6)} | ${stats.meanFaithfulness.toFixed(1).padStart(5)} | ${stats.meanCompleteness.toFixed(1).padStart(5)}`,
    );
  }

  if (summary.failures.length > 0) {
    console.log(`\nFailures (${summary.failures.length}):`);
    for (const f of summary.failures) {
      console.log(
        `  [${f.id}] recall=${f.recall.toFixed(2)} faith=${f.faithfulness} — ${f.question.slice(0, 80)}`,
      );
      if (f.error != null) {
        console.log(`    Error: ${f.error}`);
      }
    }
  } else {
    console.log('\nNo failures detected.');
  }

  console.log('='.repeat(60));
}
