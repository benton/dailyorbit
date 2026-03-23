import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { getLogger } from '../../lib/logger.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description:
      'Validate content types of downloaded attachments using file magic',
  },
  args: {
    database: databaseArg,
    limit: {
      type: 'string',
      description: 'Maximum number of attachments to validate',
    },
    verbose: {
      type: 'boolean',
      description: 'Log per-attachment details',
      default: false,
    },
  },
  async run({ args }) {
    const { runValidationPipeline } =
      await import('../../attachments/validate-pipeline.ts');

    const result = await runValidationPipeline({
      databaseUrl: resolveFromRoot(args.database),
      limit: args.limit != null ? Number(args.limit) : undefined,
      verbose: args.verbose,
    });

    const log = getLogger();
    log.info('\nSummary:');
    log.info(`  Total processed:  ${String(result.total)}`);
    log.info(`  Corrected:        ${String(result.corrected)}`);
    log.info(`  Confirmed:        ${String(result.confirmed)}`);
    log.info(`  Failed:           ${String(result.failed)}`);
    log.info(
      `  Duration:         ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
