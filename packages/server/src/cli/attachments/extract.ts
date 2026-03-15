import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const extractCommand = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract text from downloaded PDF attachments',
  },
  args: {
    database: databaseArg,
    'retry-failed': {
      type: 'boolean',
      description: 'Re-attempt previously failed extractions',
      default: false,
    },
    limit: {
      type: 'string',
      description: 'Maximum number of PDFs to process',
    },
    verbose: {
      type: 'boolean',
      description: 'Log per-attachment details',
      default: false,
    },
  },
  async run({ args }) {
    const { runExtractionPipeline } =
      await import('../../attachments/extract-pipeline.ts');

    const result = await runExtractionPipeline({
      databaseUrl: resolveFromRoot(args.database),
      retryFailed: args['retry-failed'],
      limit: args.limit != null ? Number(args.limit) : undefined,
      verbose: args.verbose,
    });

    console.log('\nSummary:');
    console.log(`  Total processed:    ${String(result.total)}`);
    console.log(`  Extracted:          ${String(result.extracted)}`);
    console.log(`  Skipped (no text):  ${String(result.skippedNoText)}`);
    console.log(`  Failed:             ${String(result.failed)}`);
    console.log(
      `  Duration:           ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
