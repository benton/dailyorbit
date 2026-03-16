import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaginatedRequest } from '../lib/pagination.ts';
import {
  getSatelliteById,
  getSatelliteFilings,
  getSatelliteStats,
} from './repository.ts';

/** Minimal space_station table matching the IBFS schema */
const CREATE_SPACE_STATION_TABLE: string = `
  CREATE TABLE space_station (
    space_station_key INTEGER NOT NULL PRIMARY KEY,
    us_name VARCHAR NOT NULL,
    itu_name VARCHAR,
    orbit_location VARCHAR,
    "verbose" VARCHAR,
    inactive_date TIMESTAMP
  )
`;

/** Minimal filing table with the columns used by the repository */
const CREATE_FILING_TABLE: string = `
  CREATE TABLE filing (
    filing_key INTEGER NOT NULL PRIMARY KEY,
    file_number VARCHAR NOT NULL,
    subsystem_code VARCHAR NOT NULL DEFAULT '',
    app_type_code VARCHAR NOT NULL DEFAULT '',
    status_code VARCHAR,
    date_filed TIMESTAMP,
    date_grant TIMESTAMP,
    address_attention VARCHAR,
    callsign VARCHAR,
    description VARCHAR
  )
`;

/** Minimal attachment table for the summary subquery */
const CREATE_ATTACHMENT_TABLE: string = `
  CREATE TABLE attachment (
    attachment_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    attachment_name VARCHAR NOT NULL DEFAULT '',
    summary TEXT
  )
`;

/** Insert sample space station rows */
async function seedSpaceStations(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO space_station VALUES
      (100, 'SATMEX-5', 'SOLIDARIDAD-2', '116.8W', 'Satmex satellite at 116.8W', NULL),
      (200, 'GALAXY-3C', NULL, '95.0W', NULL, '2020-01-15')
  `);
}

/** Insert sample filing rows linked to space stations via callsign → us_name */
async function seedFilings(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO filing VALUES
      (1, 'SAT-LOA-20200101-00001', 'SAT', 'LOA', 'Grant', '2020-01-01', '2020-02-01', 'Acme Corp', 'SATMEX-5', 'Launch auth'),
      (2, 'SAT-MOD-20200601-00002', 'SAT', 'MOD', 'Pend', '2020-06-01', NULL, 'Acme Corp', 'SATMEX-5', 'Modification'),
      (3, 'SAT-STA-20210301-00003', 'SAT', 'STA', 'Grant', '2021-03-01', '2021-04-01', 'Beta Inc', 'SATMEX-5', 'STA request'),
      (4, 'SES-NEW-20200501-00004', 'SES', 'NEW', 'Grant', '2020-05-01', '2020-06-01', 'Gamma LLC', 'GALAXY-3C', 'Earth station'),
      (5, 'SAT-LOA-20220101-00005', 'SAT', 'LOA', 'Grant', '2022-01-01', '2022-02-01', 'Delta Co', 'UNLINKED', 'Unlinked filing')
  `);
}

describe('getSatelliteById', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_SPACE_STATION_TABLE);
    await seedSpaceStations(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns the space station for a valid key', async () => {
    const result = await getSatelliteById(conn, 100);
    expect(result).toEqual({
      spaceStationKey: 100,
      usName: 'SATMEX-5',
      ituName: 'SOLIDARIDAD-2',
      orbitLocation: '116.8W',
      verbose: 'Satmex satellite at 116.8W',
      inactiveDate: null,
    });
  });

  it('returns null for a nonexistent key', async () => {
    const result = await getSatelliteById(conn, 999);
    expect(result).toBeNull();
  });

  it('handles nullable fields correctly', async () => {
    const result = await getSatelliteById(conn, 200);
    expect(result).not.toBeNull();
    expect(result!.ituName).toBeNull();
    expect(result!.verbose).toBeNull();
    expect(result!.inactiveDate).not.toBeNull();
  });
});

describe('getSatelliteFilings', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_SPACE_STATION_TABLE);
    await conn.run(CREATE_FILING_TABLE);
    await conn.run(CREATE_ATTACHMENT_TABLE);
    await seedSpaceStations(conn);
    await seedFilings(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns only filings linked to the given satellite', async () => {
    const result = await getSatelliteFilings(conn, 'SATMEX-5', {});
    expect(result.totalRows).toEqual(3);
    const fileNumbers: string[] = result.data.map((f) => f.fileNumber);
    expect(fileNumbers).toContain('SAT-LOA-20200101-00001');
    expect(fileNumbers).toContain('SAT-MOD-20200601-00002');
    expect(fileNumbers).toContain('SAT-STA-20210301-00003');
    expect(fileNumbers).not.toContain('SES-NEW-20200501-00004');
    expect(fileNumbers).not.toContain('SAT-LOA-20220101-00005');
  });

  it('returns empty data for a satellite with no filings', async () => {
    // Insert a satellite with no associated filings
    await conn.run(
      `INSERT INTO space_station VALUES (300, 'EMPTY-SAT', NULL, NULL, NULL, NULL)`,
    );
    const result = await getSatelliteFilings(conn, 'EMPTY-SAT', {});
    expect(result.data).toEqual([]);
    expect(result.totalRows).toEqual(0);
    expect(result.totalPages).toEqual(1);
  });

  it('paginates results correctly', async () => {
    const request: PaginatedRequest = { page: 1, pageSize: 2, order: 'asc' };
    const page1 = await getSatelliteFilings(conn, 'SATMEX-5', request);
    expect(page1.data.length).toEqual(2);
    expect(page1.totalRows).toEqual(3);
    expect(page1.totalPages).toEqual(2);
    expect(page1.page).toEqual(1);
    expect(page1.pageSize).toEqual(2);

    const page2 = await getSatelliteFilings(conn, 'SATMEX-5', {
      page: 2,
      pageSize: 2,
      order: 'asc',
    });
    expect(page2.data.length).toEqual(1);
    expect(page2.page).toEqual(2);
  });

  it('sorts by the requested column in descending order', async () => {
    const request: PaginatedRequest = { sort: 'date_filed', order: 'desc' };
    const result = await getSatelliteFilings(conn, 'SATMEX-5', request);
    const fileNumbers: string[] = result.data.map((f) => f.fileNumber);
    // Dates: filing 3 = 2021-03-01, filing 2 = 2020-06-01, filing 1 = 2020-01-01
    expect(fileNumbers).toEqual([
      'SAT-STA-20210301-00003',
      'SAT-MOD-20200601-00002',
      'SAT-LOA-20200101-00001',
    ]);
  });

  it('falls back to default sort for invalid sort column', async () => {
    const request: PaginatedRequest = { sort: 'DROP TABLE; --', order: 'asc' };
    // Should not throw, just falls back to date_filed
    const result = await getSatelliteFilings(conn, 'SATMEX-5', request);
    expect(result.data.length).toEqual(3);
  });

  it('maps filing fields correctly', async () => {
    const result = await getSatelliteFilings(conn, 'GALAXY-3C', {});
    expect(result.data.length).toEqual(1);
    const filing = result.data[0]!;
    expect(filing.filingKey).toEqual(4);
    expect(filing.fileNumber).toEqual('SES-NEW-20200501-00004');
    expect(filing.subsystemCode).toEqual('SES');
    expect(filing.appTypeCode).toEqual('NEW');
    expect(filing.statusCode).toEqual('Grant');
    expect(filing.addressAttention).toEqual('Gamma LLC');
    expect(filing.callsign).toEqual('GALAXY-3C');
    expect(filing.description).toEqual('Earth station');
  });
});

describe('getSatelliteStats', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_SPACE_STATION_TABLE);
    await conn.run(CREATE_FILING_TABLE);
    await conn.run(CREATE_ATTACHMENT_TABLE);
    await seedSpaceStations(conn);
    await seedFilings(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns correct stats for a satellite with multiple filings', async () => {
    const stats = await getSatelliteStats(conn, 'SATMEX-5');
    expect(stats.totalFilings).toEqual(3);
    expect(stats.distinctApplicantCount).toEqual(2); // Acme Corp and Beta Inc
    // Most recent filing date should be 2021-03-01
    expect(stats.mostRecentFilingDate).not.toBeNull();
    expect(stats.mostRecentFilingDate!).toContain('2021');
  });

  it('returns correct stats for a satellite with one filing', async () => {
    const stats = await getSatelliteStats(conn, 'GALAXY-3C');
    expect(stats.totalFilings).toEqual(1);
    expect(stats.distinctApplicantCount).toEqual(1);
    expect(stats.mostRecentFilingDate).not.toBeNull();
  });

  it('returns zero stats for a satellite with no filings', async () => {
    await conn.run(
      `INSERT INTO space_station VALUES (300, 'EMPTY-SAT', NULL, NULL, NULL, NULL)`,
    );
    const stats = await getSatelliteStats(conn, 'EMPTY-SAT');
    expect(stats.totalFilings).toEqual(0);
    expect(stats.mostRecentFilingDate).toBeNull();
    expect(stats.distinctApplicantCount).toEqual(0);
  });
});
