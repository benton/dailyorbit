import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { getLogger } from '../../lib/logger.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const ibfsCommand = defineCommand({
  meta: {
    name: 'ibfs',
    description: 'Load IBFS bulk .dat files into DuckDB',
  },
  args: {
    database: databaseArg,
    ddl: {
      type: 'string',
      description: 'Path to Sybase DDL file',
      default: 'tmp/ibfs-schema.txt',
    },
    'dat-dir': {
      type: 'string',
      description: 'Path to extracted .dat files directory',
      default: 'tmp/IBFS',
    },
    tables: {
      type: 'string',
      description: 'Comma-separated table names to load',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Parse and validate only, no DB writes',
      default: false,
    },
    download: {
      type: 'boolean',
      description: 'Download and extract IBFS.zip before ingesting',
      default: false,
    },
    'source-url': {
      type: 'string',
      description: 'Override the default FTP URL for the zip download',
    },
  },
  async run({ args }) {
    const databaseUrl: string = resolveFromRoot(args.database);
    const ddlPath: string = resolveFromRoot(args.ddl);
    const datDir: string = resolveFromRoot(args['dat-dir']);
    const tables: string[] | undefined = args.tables?.split(',');
    const dryRun: boolean = args['dry-run'];
    const shouldDownload: boolean = args.download;
    const sourceUrl: string | undefined = args['source-url'];

    let resolvedDatDir: string = datDir;
    let zipSizeBytes: number | undefined;

    if (shouldDownload) {
      const { downloadAndExtract } = await import('../../ingest/download.ts');
      const downloadResult = downloadAndExtract({
        sourceUrl,
        extractDir: datDir,
      });
      resolvedDatDir = downloadResult.datDir;
      zipSizeBytes = downloadResult.zipSizeBytes;
    }

    const { runIngest } = await import('../../ingest/pipeline.ts');
    const result = await runIngest({
      databaseUrl,
      ddlPath,
      datDir: resolvedDatDir,
      tables,
      dryRun,
      sourceUrl,
      zipSizeBytes,
    });

    if (result.tablesSkipped.length > 0) {
      const log = getLogger();
      log.info(`Skipped tables: ${result.tablesSkipped.join(', ')}`);
    }
  },
});
