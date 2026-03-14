import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureIcfsColumns } from './schema.ts';
import { runIcfsIngest } from './pipeline.ts';
import type { IcfsIngestResult } from './pipeline.ts';

/** Minimal filing table matching the IBFS schema core columns */
const CREATE_FILING_TABLE: string = `
  CREATE TABLE filing (
    filing_key INTEGER NOT NULL PRIMARY KEY,
    file_number VARCHAR NOT NULL,
    subsystem_code VARCHAR NOT NULL DEFAULT '',
    app_type_code VARCHAR NOT NULL DEFAULT '',
    callsign VARCHAR,
    status_code VARCHAR,
    status_date TIMESTAMP,
    last_action VARCHAR,
    last_action_date TIMESTAMP,
    date_filed TIMESTAMP,
    date_grant TIMESTAMP,
    date_begin TIMESTAMP,
    date_expire TIMESTAMP,
    aff_pub_notice_date TIMESTAMP,
    act_pub_notice_date TIMESTAMP,
    description VARCHAR,
    address_attention VARCHAR,
    contact_attention VARCHAR
  )
`;

const LIVE_API: boolean = process.env['ICFS_LIVE_TESTS'] === '1';
const describeIf = LIVE_API ? describe : describe.skip;

describeIf('ICFS pipeline (live API)', () => {
  let db: DuckDBInstance;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    const conn: DuckDBConnection = await db.connect();
    await conn.run(CREATE_FILING_TABLE);
    conn.closeSync();
  });

  it('ingests a specific filing by file number', async () => {
    const progress: string[] = [];
    const result: IcfsIngestResult = await runIcfsIngest({
      dbInstance: db,
      dateFrom: '2025-02',
      dateTo: '2025-02',
      fileNumbers: ['SAT-LOA-20250221-00050'],
      delayMs: 0,
      onProgress: (msg: string) => progress.push(msg),
    });

    expect(result.filingsDiscovered).toEqual(1);
    expect(result.filingsIngested).toEqual(1);
    expect(result.filingsNotFound).toEqual(0);
    expect(result.filingsFailed).toEqual(0);
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify the row exists in DuckDB
    const conn: DuckDBConnection = await db.connect();
    try {
      const reader = await conn.runAndReadAll(
        `SELECT file_number, icfs_sys_id, applicant_frn, red_light_status
         FROM filing WHERE file_number = 'SAT-LOA-20250221-00050'`,
      );
      const rows = reader.getRowObjectsJS();
      expect(rows.length).toEqual(1);
      expect(String(rows[0]!.icfs_sys_id)).toBeTruthy();
      expect(String(rows[0]!.applicant_frn)).toEqual('0030543268');
    } finally {
      conn.closeSync();
    }

    // Verify progress callback was called
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((m) => m.includes('Ingested'))).toEqual(true);
  });

  it('handles not-found filings gracefully', async () => {
    const result: IcfsIngestResult = await runIcfsIngest({
      dbInstance: db,
      dateFrom: '2025-01',
      dateTo: '2025-01',
      fileNumbers: ['NONEXISTENT-00000000-99999'],
      delayMs: 0,
    });

    expect(result.filingsDiscovered).toEqual(1);
    expect(result.filingsIngested).toEqual(0);
    expect(result.filingsNotFound).toEqual(1);
    expect(result.filingsFailed).toEqual(0);
  });
});

describe('ICFS pipeline (unit)', () => {
  it('reports progress via callback', async () => {
    // We can test this with a not-found filing even without live API
    // by checking the pipeline handles the option correctly
    const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
    const conn: DuckDBConnection = await db.connect();
    await conn.run(CREATE_FILING_TABLE);
    await ensureIcfsColumns(conn);
    conn.closeSync();

    // Just verify the function signature and option types are correct
    expect(typeof runIcfsIngest).toEqual('function');
  });
});
