import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { getConfigService, setConfigService } from '../../lib/config.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { readKeyFile } from '../../lib/encryption.ts';
import { trackConnection, trackInstance } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

const keyFileArg = {
  type: 'string',
  description: 'Path to encryption key file for config lookup',
  default: 'data/daily-orbit.key',
} as const;

type ManifestTable = {
  name: string;
  rows: number;
  sizeBytes: number;
};

type Manifest = {
  exported_at: string;
  duckdb_version: string;
  tables: ManifestTable[];
};

async function s3GetString(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (result.Body == null) {
    throw new Error(`Empty response body for s3://${bucket}/${key}`);
  }
  return result.Body.transformToString();
}

export const importParquetCommand = defineCommand({
  meta: {
    name: 'import-parquet',
    description:
      'Restore core tables from S3 Parquet files into a fresh DuckDB database (disaster recovery)',
  },
  args: {
    database: {
      ...databaseArg,
      description:
        'Path to output DuckDB database file (will be created/overwritten)',
    },
    keyFile: keyFileArg,
    bucket: {
      type: 'string',
      description: 'S3 bucket name (defaults to snapshotBucket config)',
    },
    prefix: {
      type: 'string',
      description: 'S3 key prefix for Parquet files',
      default: 'parquet/',
    },
    sourceDatabase: {
      type: 'string',
      description:
        'Existing database path for config lookup (if different from output database)',
      default: '',
    },
  },
  async run({ args }) {
    const log = getLogger();
    const startedAt = Date.now();

    // Resolve config from either the source DB (if provided) or the output DB path
    const configDbPath: string =
      args.sourceDatabase !== ''
        ? resolveFromRoot(args.sourceDatabase)
        : resolveFromRoot(args.database);

    const keyPath: string = resolveFromRoot(args.keyFile);
    const key: Buffer = readKeyFile(keyPath);

    const configDb = await DuckDBInstance.create(configDbPath);
    trackInstance(configDb);
    const configConn: DuckDBConnection =
      await DuckDBConnection.create(configDb);
    trackConnection(configConn);

    const config: ConfigService = new ConfigService(configDb, key);
    await config.load();
    setConfigService(config);

    const bucket: string =
      args.bucket !== '' && args.bucket != null
        ? args.bucket
        : String(getConfigService().get('snapshotBucket'));
    const region: string = String(getConfigService().get('snapshotRegion'));
    const prefix: string = args.prefix;

    configConn.closeSync();

    if (!bucket) {
      log.error(
        'bucket is required (pass --bucket or set snapshotBucket config)',
      );
      process.exit(1);
    }

    const s3 = new S3Client({ region });

    // 1. Download manifest
    log.info({ bucket, prefix }, 'Downloading manifest');
    const manifestJson = await s3GetString(
      s3,
      bucket,
      `${prefix}_manifest.json`,
    );
    const manifest: Manifest = JSON.parse(manifestJson) as Manifest;
    log.info(
      { exported_at: manifest.exported_at, tables: manifest.tables.length },
      'Manifest loaded',
    );

    // 2. Download schema.sql
    log.info('Downloading schema.sql');
    const schemaSql = await s3GetString(s3, bucket, `${prefix}schema.sql`);

    // 3. Create fresh DuckDB database (overwrite if exists)
    const outPath: string = resolveFromRoot(args.database);
    const db = await DuckDBInstance.create(outPath);
    trackInstance(db);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    // 4. Create tables from schema.sql (DDL only, no FTS indexes)
    log.info('Creating schema');
    await conn.run(schemaSql);

    // 5. Configure S3 access for COPY FROM
    await conn.run(`INSTALL httpfs; LOAD httpfs;`);
    await conn.run(
      `SET s3_region = '${region}'; SET s3_use_credential_chain = 'true';`,
    );

    // 6. Load each table from its Parquet file
    let totalRows = 0;
    for (const table of manifest.tables) {
      const s3Key = `s3://${bucket}/${prefix}${table.name}.parquet`;
      log.info(
        { table: table.name, expectedRows: table.rows, s3Key },
        'Loading table',
      );

      await conn.run(
        `INSERT INTO "${table.name}" SELECT * FROM read_parquet('${s3Key}')`,
      );

      const countResult = await conn.runAndReadAll(
        `SELECT COUNT(*)::INTEGER AS cnt FROM "${table.name}"`,
      );
      const actualRows = Number(
        (countResult.getRowObjectsJS()[0] as { cnt: number } | undefined)
          ?.cnt ?? 0,
      );
      totalRows += actualRows;
      log.info({ table: table.name, rows: actualRows }, 'Table loaded');
    }

    // 7. Checkpoint to flush WAL
    await conn.run('FORCE CHECKPOINT');

    const elapsedMs = Date.now() - startedAt;
    log.info(
      {
        tables: manifest.tables.length,
        totalRows,
        elapsedMs,
        database: outPath,
      },
      'Parquet import complete',
    );
  },
});
