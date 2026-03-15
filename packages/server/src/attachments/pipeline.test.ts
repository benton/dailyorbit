import { beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { runAttachmentPipeline } from './pipeline.ts';
import type { AttachmentPipelineResult } from './types.ts';

/**
 * Helper: create a minimal filing table with test data so that
 * getFilingsForScope can query it.
 */
async function seedFilingTable(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS filing (
      filing_key INTEGER NOT NULL,
      file_number VARCHAR NOT NULL,
      subsystem_code VARCHAR NOT NULL,
      app_type_code VARCHAR NOT NULL,
      date_filed DATE
    )
  `);
  await conn.run(`INSERT INTO filing VALUES ($1, $2, $3, $4, $5)`, [
    1,
    'SATSTA2023061400142',
    'SAT',
    'STA',
    '2023-06-14',
  ] as DuckDBValue[]);
  await conn.run(`INSERT INTO filing VALUES ($1, $2, $3, $4, $5)`, [
    2,
    'SESLOA2024010100001',
    'SES',
    'LOA',
    '2024-01-01',
  ] as DuckDBValue[]);
}

describe('runAttachmentPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await seedFilingTable(conn);
    conn.closeSync();
  });

  it('discovers attachments for scoped filings using fcc-gov stub provider', async () => {
    const logs: string[] = [];
    const result: AttachmentPipelineResult = await runAttachmentPipeline({
      dbInstance: db,
      storageBasePath: '/tmp/test-attachments',
      provider: 'fcc-gov',
      scope: { subsystems: ['SAT'], limit: 1 },
      discoverOnly: true,
      delayMs: 0,
      onProgress: (msg: string) => logs.push(msg),
    });

    expect(result.filingsProcessed).toEqual(1);
    // fcc-gov stub returns empty, so 0 discovered
    expect(result.attachmentsDiscovered).toEqual(0);
    expect(result.attachmentsDownloaded).toEqual(0);
    expect(result.attachmentsFailed).toEqual(0);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('discover-only mode skips download phase', async () => {
    const logs: string[] = [];
    const result: AttachmentPipelineResult = await runAttachmentPipeline({
      dbInstance: db,
      storageBasePath: '/tmp/test-attachments',
      provider: 'fcc-gov',
      scope: { subsystems: ['SAT', 'SES'] },
      discoverOnly: true,
      delayMs: 0,
      onProgress: (msg: string) => logs.push(msg),
    });

    expect(result.filingsProcessed).toEqual(2);
    expect(result.attachmentsDownloaded).toEqual(0);
    // Verify no "pending download" messages since discoverOnly
    const downloadLogs: string[] = logs.filter((l) =>
      l.includes('pending download'),
    );
    expect(downloadLogs).toHaveLength(0);
  });

  it('records discovery in attachment_discovery for processed filings', async () => {
    await runAttachmentPipeline({
      dbInstance: db,
      storageBasePath: '/tmp/test-attachments',
      provider: 'fcc-gov',
      scope: { subsystems: ['SAT'], limit: 1 },
      discoverOnly: true,
      delayMs: 0,
    });

    const checkConn: DuckDBConnection = await DuckDBConnection.create(db);
    const reader = await checkConn.runAndReadAll(
      `SELECT filing_key, discovered_at FROM attachment_discovery ORDER BY filing_key`,
    );
    const rows = reader.getRowObjectsJS();
    // SAT filing (key=1) was processed — should have a discovery record
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.filing_key)).toEqual(1);
    expect(rows[0]!.discovered_at).not.toBeNull();
    checkConn.closeSync();
  });

  it('reports pipeline duration in milliseconds', async () => {
    const result: AttachmentPipelineResult = await runAttachmentPipeline({
      dbInstance: db,
      storageBasePath: '/tmp/test-attachments',
      provider: 'fcc-gov',
      scope: { limit: 1 },
      discoverOnly: true,
      delayMs: 0,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
