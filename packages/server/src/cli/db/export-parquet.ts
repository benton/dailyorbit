import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import {
  runParquetExport,
  runParquetExportLocal,
} from '../../backup/parquet-export-service.ts';
import { ensureBackupTables } from '../../backup/schema.ts';
import { getConfigService, setConfigService } from '../../lib/config.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { readKeyFile } from '../../lib/encryption.ts';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';

const keyFileArg = {
  type: 'string',
  description: 'Path to encryption key file',
  default: 'data/daily-orbit.key',
} as const;

export const exportParquetCommand = defineCommand({
  meta: {
    name: 'export-parquet',
    description:
      'Export all main schema tables as Parquet files (to S3 or local directory)',
  },
  args: {
    database: databaseArg,
    keyFile: keyFileArg,
    output: {
      type: 'string',
      description:
        'Local directory to write Parquet files to (bypasses S3 entirely)',
    },
    bucket: {
      type: 'string',
      description: 'S3 bucket name (defaults to snapshotBucket config)',
    },
    prefix: {
      type: 'string',
      description: 'S3 key prefix for Parquet files',
      default: 'parquet/',
    },
  },
  async run({ args }) {
    const log = getLogger();
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    const key: Buffer = readKeyFile(resolveFromRoot(args.keyFile));
    const config: ConfigService = new ConfigService(db, key);
    await config.load();
    setConfigService(config);
    await ensureBackupTables(conn);

    // Local filesystem export
    if (args.output) {
      const outputDir: string = resolveFromRoot(args.output);
      log.info({ outputDir }, 'Starting local Parquet export');
      const result = await runParquetExportLocal(conn, { outputDir });
      log.info(
        { tableCount: result.tablesExported, outputDir },
        'Local Parquet export complete',
      );
      return;
    }

    // S3 export
    const bucket: string =
      args.bucket ?? String(getConfigService().get('snapshotBucket'));
    const region: string = String(getConfigService().get('snapshotRegion'));
    const prefix: string = args.prefix;

    if (!bucket) {
      log.error(
        'bucket is required (pass --bucket or set snapshotBucket config)',
      );
      process.exit(1);
    }

    log.info({ bucket, prefix }, 'Starting Parquet export to S3');
    const result = await runParquetExport(conn, { bucket, region, prefix });
    log.info(
      { tableCount: result.tablesExported, prefix },
      'Parquet export complete',
    );
  },
});
