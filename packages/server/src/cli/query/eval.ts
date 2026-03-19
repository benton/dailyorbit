import type { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const evalCommand = defineCommand({
  meta: {
    name: 'eval',
    description:
      'Run the RAG query evaluation harness against a curated dataset',
  },
  args: {
    database: databaseArg,
    dataset: {
      type: 'string',
      description: 'Path to evaluation dataset JSON file',
    },
    model: {
      type: 'string',
      description:
        'Model ID for all LLM calls (rewrite, generate, judge). Overrides individual model settings.',
    },
    verbose: {
      type: 'boolean',
      description: 'Show detailed output for each evaluation case',
      default: false,
    },
  },
  async run({ args }) {
    const duckdb = await import('@duckdb/node-api');
    const { setDbPath, getDb } = await import('../../lib/db.ts');
    const { BedrockClient } = await import('../../inference/bedrock-client.ts');
    const { EmbeddingService } =
      await import('../../inference/embedding-service.ts');
    const { runEvaluation, printSummary } =
      await import('../../query/eval/evaluate.ts');

    setDbPath(resolveFromRoot(args.database));
    const db = await getDb();
    const conn: DuckDBConnection = await duckdb.DuckDBConnection.create(db);

    const region: string = process.env.AWS_REGION ?? 'us-east-2';
    const client = new BedrockClient(region);

    // Build embedding context
    const embeddingModelId: string = 'amazon.titan-embed-text-v2:0';
    const embeddingService = new EmbeddingService(client);
    const embeddingCtx = {
      service: embeddingService,
      modelId: embeddingModelId,
      dimensions: 512,
      normalize: true,
    };

    try {
      const summary = await runEvaluation(conn, client, embeddingCtx, {
        datasetPath: args.dataset ? resolveFromRoot(args.dataset) : undefined,
        rewriteModelId: args.model ?? undefined,
        generateModelId: args.model ?? undefined,
        judgeModelId: args.model ?? undefined,
        verbose: args.verbose,
      });

      printSummary(summary);

      // Exit with non-zero if too many failures
      const failRate: number = summary.failures.length / summary.totalCases;
      if (failRate > 0.3) {
        console.error(
          `\nFail rate ${(failRate * 100).toFixed(0)}% exceeds 30% threshold`,
        );
        process.exit(1);
      }
    } finally {
      conn.closeSync();
    }
  },
});
