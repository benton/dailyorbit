import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
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

type TableManifestEntry = {
  name: string;
  rows: number;
  sizeBytes: number;
};

export const exportParquetCommand = defineCommand({
  meta: {
    name: 'export-parquet',
    description:
      'Export all main schema tables to S3 as Parquet files for disaster recovery',
  },
  args: {
    database: databaseArg,
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

    // Load S3 extension and configure credentials from EC2 instance profile
    await conn.run(`INSTALL httpfs; LOAD httpfs;`);
    await conn.run(
      `SET s3_region = '${region}'; SET s3_use_credential_chain = 'true';`,
    );

    // Get all base tables in the main schema
    const tablesResult = await conn.runAndReadAll(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'main'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = (
      tablesResult.getRowObjectsJS() as Array<{ table_name: string }>
    ).map((r) => r.table_name);

    // Get DuckDB version
    const versionResult = await conn.runAndReadAll(`SELECT version() AS v`);
    const duckdbVersion = String(
      (versionResult.getRowObjectsJS()[0] as { v: string } | undefined)?.v ??
        'unknown',
    );

    log.info(
      { tableCount: tables.length, duckdbVersion },
      'Starting Parquet export',
    );

    const exportedAt = new Date();
    const tableManifest: TableManifestEntry[] = [];

    for (const table of tables) {
      const s3Key = `s3://${bucket}/${prefix}${table}.parquet`;
      log.info({ table, s3Key }, 'Exporting table');

      const countResult = await conn.runAndReadAll(
        `SELECT COUNT(*)::INTEGER AS cnt FROM "${table}"`,
      );
      const rows = Number(
        (countResult.getRowObjectsJS()[0] as { cnt: number } | undefined)
          ?.cnt ?? 0,
      );

      await conn.run(`COPY "${table}" TO '${s3Key}' (FORMAT PARQUET)`);

      tableManifest.push({ name: table, rows, sizeBytes: 0 });
      log.info({ table, rows }, 'Table exported');
    }

    // Export schema.sql via EXPORT DATABASE to a temp directory, then upload
    const tempDir = mkdtempSync(join(tmpdir(), 'daily-orbit-export-'));
    try {
      await conn.run(`EXPORT DATABASE '${tempDir}' (FORMAT PARQUET)`);
      const schemaContent = readFileSync(join(tempDir, 'schema.sql'), 'utf-8');

      const s3Client = new S3Client({ region });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}schema.sql`,
          Body: schemaContent,
          ContentType: 'text/plain',
        }),
      );
      log.info('schema.sql uploaded');

      const manifest = {
        exported_at: exportedAt.toISOString(),
        duckdb_version: duckdbVersion,
        tables: tableManifest,
      };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}_manifest.json`,
          Body: JSON.stringify(manifest, null, 2),
          ContentType: 'application/json',
        }),
      );
      log.info({ tables: tableManifest.length }, 'Manifest uploaded');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    log.info({ tableCount: tables.length, prefix }, 'Parquet export complete');
  },
});
