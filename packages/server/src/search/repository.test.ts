import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autocomplete,
  searchEarthStations,
  searchFilings,
  searchSatellites,
} from './repository.ts';

// ---------------------------------------------------------------------------
// Schema setup
// ---------------------------------------------------------------------------

const CREATE_FILING_TABLE: string = `
  CREATE TABLE filing (
    filing_key INTEGER NOT NULL PRIMARY KEY,
    file_number VARCHAR NOT NULL,
    callsign VARCHAR,
    subsystem_code VARCHAR NOT NULL DEFAULT '',
    app_type_code VARCHAR NOT NULL DEFAULT '',
    status_code VARCHAR,
    date_filed TIMESTAMP,
    address_attention VARCHAR,
    applicant_city VARCHAR,
    applicant_state VARCHAR
  )
`;

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

const CREATE_EARTH_STATION_STA_TABLE: string = `
  CREATE TABLE earth_station_sta (
    filing_key INTEGER NOT NULL PRIMARY KEY,
    type_sta_code VARCHAR,
    city VARCHAR,
    state_code VARCHAR
  )
`;

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

async function seedFilings(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO filing VALUES
      (1, 'SAT-LOA-20250101-00001', 'S1001', 'SAT', 'LOA', 'P', '2025-01-01', 'SpaceX Inc', 'Hawthorne', 'CA'),
      (2, 'SAT-MOD-20250215-00002', 'S1002', 'SAT', 'MOD', 'G', '2025-02-15', 'OneWeb Ltd', 'London', 'VA'),
      (3, 'SES-LIC-20250301-00003', 'E2001', 'SES', 'LIC', 'P', '2025-03-01', 'Viasat Inc', 'Carlsbad', 'CA'),
      (4, 'SES-STA-20250401-00004', 'E2001', 'SES', 'STA', 'G', '2025-04-01', 'Viasat Inc', 'Carlsbad', 'CA'),
      (5, 'SES-LIC-20250501-00005', 'E3001', 'SES', 'LIC', 'P', '2025-05-01', 'Hughes Network', 'Germantown', 'MD'),
      (6, 'ITC-214-20250601-00006', NULL, 'ITC', '214', 'P', '2025-06-01', 'AT&T', 'Dallas', 'TX')
  `);
}

async function seedSpaceStations(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO space_station VALUES
      (100, 'SPACEX-1', 'SX1-ITU', '97.0W', 'SpaceX satellite', NULL),
      (101, 'SPACEX-2', 'SX2-ITU', '99.0W', 'SpaceX satellite 2', NULL),
      (102, 'ONEWEB-1', 'OW1-ITU', '0.0E', 'OneWeb satellite', '2024-06-01'),
      (103, 'VIASAT-KA', NULL, '70.0W', 'Viasat Ka-band', NULL)
  `);
}

async function seedEarthStationSta(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO earth_station_sta VALUES
      (3, 'FIX', 'Carlsbad', 'CA'),
      (4, 'TMP', 'Carlsbad', 'CA'),
      (5, 'FIX', 'Germantown', 'MD')
  `);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: DuckDBInstance;
let conn: DuckDBConnection;

beforeEach(async () => {
  db = await DuckDBInstance.create(':memory:');
  conn = await DuckDBConnection.create(db);
  await conn.run(CREATE_FILING_TABLE);
  await conn.run(CREATE_SPACE_STATION_TABLE);
  await conn.run(CREATE_EARTH_STATION_STA_TABLE);
  await seedFilings(conn);
  await seedSpaceStations(conn);
  await seedEarthStationSta(conn);
});

afterEach(() => {
  conn.closeSync();
});

// ---------------------------------------------------------------------------
// searchFilings
// ---------------------------------------------------------------------------

describe('searchFilings', () => {
  it('returns all filings when no filters are applied', async () => {
    const result = await searchFilings(conn, {}, { page: 1, pageSize: 25 });
    expect(result.totalRows).toEqual(6);
    expect(result.data.length).toEqual(6);
    expect(result.page).toEqual(1);
  });

  it('filters by file_number ILIKE', async () => {
    const result = await searchFilings(
      conn,
      { file_number: 'SAT-LOA' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.file_number).toEqual('SAT-LOA-20250101-00001');
  });

  it('filters by callsign ILIKE', async () => {
    const result = await searchFilings(
      conn,
      { callsign: 'E2001' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(2);
    expect(result.data.every((r) => r.callsign === 'E2001')).toEqual(true);
  });

  it('filters by applicant (address_attention) ILIKE', async () => {
    const result = await searchFilings(
      conn,
      { applicant: 'spacex' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.address_attention).toEqual('SpaceX Inc');
  });

  it('filters by subsystem_code IN list', async () => {
    const result = await searchFilings(
      conn,
      { subsystem_code: ['SAT'] },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(2);
    expect(result.data.every((r) => r.subsystem_code === 'SAT')).toEqual(true);
  });

  it('filters by multiple subsystem codes', async () => {
    const result = await searchFilings(
      conn,
      { subsystem_code: ['SAT', 'ITC'] },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(3);
  });

  it('filters by app_type_code IN list', async () => {
    const result = await searchFilings(
      conn,
      { app_type_code: ['LOA', 'LIC'] },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(3);
  });

  it('filters by status_code IN list', async () => {
    const result = await searchFilings(
      conn,
      { status_code: ['G'] },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(2);
    expect(result.data.every((r) => r.status_code === 'G')).toEqual(true);
  });

  it('filters by date range', async () => {
    const result = await searchFilings(
      conn,
      { date_filed_from: '2025-03-01', date_filed_to: '2025-05-31' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(3);
  });

  it('combines multiple filters with AND logic', async () => {
    const result = await searchFilings(
      conn,
      { subsystem_code: ['SES'], status_code: ['P'] },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(2);
  });

  it('paginates results correctly', async () => {
    const page1 = await searchFilings(conn, {}, { page: 1, pageSize: 2 });
    expect(page1.data.length).toEqual(2);
    expect(page1.totalRows).toEqual(6);
    expect(page1.totalPages).toEqual(3);

    const page2 = await searchFilings(conn, {}, { page: 2, pageSize: 2 });
    expect(page2.data.length).toEqual(2);
    expect(page2.page).toEqual(2);

    // No overlap between pages
    const page1Numbers: string[] = page1.data.map((r) => r.file_number);
    const page2Numbers: string[] = page2.data.map((r) => r.file_number);
    expect(page1Numbers.some((n) => page2Numbers.includes(n))).toEqual(false);
  });

  it('returns empty result for filters matching nothing', async () => {
    const result = await searchFilings(
      conn,
      { file_number: 'NONEXISTENT' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(0);
    expect(result.data).toEqual([]);
  });

  it('trims whitespace from text filter values', async () => {
    const result = await searchFilings(
      conn,
      { applicant: '  SpaceX  ' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
  });
});

// ---------------------------------------------------------------------------
// searchSatellites
// ---------------------------------------------------------------------------

describe('searchSatellites', () => {
  it('returns all satellites when no filters are applied', async () => {
    const result = await searchSatellites(conn, {}, { page: 1, pageSize: 25 });
    expect(result.totalRows).toEqual(4);
  });

  it('filters by us_name ILIKE', async () => {
    const result = await searchSatellites(
      conn,
      { us_name: 'SPACEX' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(2);
    expect(result.data.every((r) => r.us_name.includes('SPACEX'))).toEqual(
      true,
    );
  });

  it('filters by itu_name ILIKE', async () => {
    const result = await searchSatellites(
      conn,
      { itu_name: 'SX1' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.itu_name).toEqual('SX1-ITU');
  });

  it('filters by orbit_location ILIKE', async () => {
    const result = await searchSatellites(
      conn,
      { orbit_location: '97' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.us_name).toEqual('SPACEX-1');
  });

  it('filters active satellites (inactive_date IS NULL)', async () => {
    const result = await searchSatellites(
      conn,
      { active: true },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(3);
    expect(result.data.every((r) => r.inactive_date === null)).toEqual(true);
  });

  it('filters inactive satellites (inactive_date IS NOT NULL)', async () => {
    const result = await searchSatellites(
      conn,
      { active: false },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.us_name).toEqual('ONEWEB-1');
    expect(result.data[0]!.inactive_date).not.toBeNull();
  });

  it('handles null itu_name in results', async () => {
    const result = await searchSatellites(
      conn,
      { us_name: 'VIASAT' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.itu_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchEarthStations
// ---------------------------------------------------------------------------

describe('searchEarthStations', () => {
  it('returns SES-subsystem filings grouped by callsign', async () => {
    const result = await searchEarthStations(
      conn,
      {},
      { page: 1, pageSize: 25 },
    );
    // SES filings: E2001 (2 filings), E3001 (1 filing)
    expect(result.totalRows).toEqual(2);
    const viasat = result.data.find((r) => r.callsign === 'E2001');
    expect(viasat).toBeDefined();
    expect(viasat!.filing_count).toEqual(2);
  });

  it('filters by callsign ILIKE', async () => {
    const result = await searchEarthStations(
      conn,
      { callsign: 'E2001' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.callsign).toEqual('E2001');
  });

  it('filters by applicant (address_attention) ILIKE', async () => {
    const result = await searchEarthStations(
      conn,
      { applicant: 'Hughes' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.callsign).toEqual('E3001');
  });

  it('filters by state via earth_station_sta join', async () => {
    const result = await searchEarthStations(
      conn,
      { state: 'CA' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.callsign).toEqual('E2001');
  });

  it('filters by city via earth_station_sta join', async () => {
    const result = await searchEarthStations(
      conn,
      { city: 'Germantown' },
      { page: 1, pageSize: 25 },
    );
    expect(result.totalRows).toEqual(1);
    expect(result.data[0]!.callsign).toEqual('E3001');
  });

  it('does not include non-SES filings', async () => {
    const result = await searchEarthStations(
      conn,
      {},
      { page: 1, pageSize: 25 },
    );
    const callsigns: string[] = result.data.map((r) => r.callsign);
    // S1001 and S1002 are SAT filings, should not appear
    expect(callsigns).not.toContain('S1001');
    expect(callsigns).not.toContain('S1002');
  });
});

// ---------------------------------------------------------------------------
// autocomplete
// ---------------------------------------------------------------------------

describe('autocomplete', () => {
  it('returns distinct filing field values matching prefix', async () => {
    const result = await autocomplete(conn, 'filings', 'subsystem_code', 'SA');
    expect(result).toEqual(['SAT']);
  });

  it('returns multiple matches for filing callsign', async () => {
    const result = await autocomplete(conn, 'filings', 'callsign', 'E');
    expect(result).toContain('E2001');
    expect(result).toContain('E3001');
  });

  it('returns distinct satellite us_name values', async () => {
    const result = await autocomplete(conn, 'satellites', 'us_name', 'SPACE');
    expect(result).toContain('SPACEX-1');
    expect(result).toContain('SPACEX-2');
    expect(result.length).toEqual(2);
  });

  it('returns empty array for disallowed entity', async () => {
    const result = await autocomplete(conn, 'unknown', 'field', 'test');
    expect(result).toEqual([]);
  });

  it('returns empty array for disallowed field', async () => {
    const result = await autocomplete(conn, 'filings', 'secret_column', 'test');
    expect(result).toEqual([]);
  });

  it('respects limit parameter', async () => {
    const result = await autocomplete(conn, 'filings', 'file_number', '', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('returns earth-station autocomplete for callsign', async () => {
    const result = await autocomplete(conn, 'earth-stations', 'callsign', 'E');
    expect(result).toContain('E2001');
    expect(result).toContain('E3001');
  });

  it('returns earth-station autocomplete for city via join', async () => {
    const result = await autocomplete(conn, 'earth-stations', 'city', 'Carl');
    expect(result).toContain('Carlsbad');
  });

  it('returns earth-station autocomplete for state via join', async () => {
    const result = await autocomplete(conn, 'earth-stations', 'state', 'C');
    expect(result).toContain('CA');
  });

  it('trims whitespace from query', async () => {
    const result = await autocomplete(
      conn,
      'filings',
      'subsystem_code',
      '  SA  ',
    );
    expect(result).toEqual(['SAT']);
  });

  it('caps limit at 50 even when higher value requested', async () => {
    // Should not throw, just silently cap
    const result = await autocomplete(conn, 'filings', 'file_number', '', 200);
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
