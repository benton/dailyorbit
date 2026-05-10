import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';
import { ensureBackupTables } from '../../backup/schema.ts';
import { createBackupService } from '../../backup/backup-service.ts';
import { createS3Uploader } from '../../backup/s3-client.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { readKeyFile } from '../../lib/encryption.ts';
import { setConfigService, getConfigService } from '../../lib/config.ts';

const keyFileArg = {
  type: 'string',
  description: 'Path to encryption key file',
  default: 'data/daily-orbit.key',
} as const;

export const snapshotCommand = defineCommand({
  meta: {
    name: 'snapshot',
    description: 'Checkpoint the database and upload a snapshot to S3',
  },
  args: {
    database: databaseArg,
    keyFile: keyFileArg,
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

    const bucket: string = String(getConfigService().get('snapshotBucket'));
    const prefix: string = String(getConfigService().get('snapshotPrefix'));
    const region: string = String(getConfigService().get('snapshotRegion'));

    if (!bucket) {
      log.error('snapshotBucket config is not set');
      process.exit(1);
    }

    const uploader = createS3Uploader({ bucket, prefix, region });
    const dbPath: string = resolveFromRoot(args.database);
    const service = createBackupService({
      conn,
      uploader,
      dbPath,
      snapshotPrefix: prefix,
      retentionCount: 2,
      parquetExport: { bucket, region, prefix: 'parquet/' },
    });

    await service.runBackup('cli');
    log.info('Snapshot complete');
  },
});
