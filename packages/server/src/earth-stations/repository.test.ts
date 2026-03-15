import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import {
  getEarthStationAntennas,
  getEarthStationByCallsign,
  getEarthStationFilings,
  getEarthStationStats,
} from './repository.ts';
import type {
  EarthStationAntenna,
  EarthStationFiling,
  EarthStationInfo,
  EarthStationStats,
} from './types.ts';
import type { PaginatedResponse } from '../lib/pagination.ts';

/** Create the minimal tables needed for earth station queries */
async function createTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE filing (
      filing_key INTEGER NOT NULL,
      file_number VARCHAR NOT NULL,
      subsystem_code VARCHAR NOT NULL,
      app_type_code VARCHAR NOT NULL,
      callsign VARCHAR,
      status_code VARCHAR,
      date_filed TIMESTAMP,
      date_grant TIMESTAMP,
      date_expire TIMESTAMP,
      description VARCHAR,
      address_attention VARCHAR,
      applicant_city VARCHAR,
      applicant_state VARCHAR,
      applicant_country VARCHAR
    )
  `);

  await conn.run(`
    CREATE TABLE site (
      site_key INTEGER NOT NULL,
      filing_key INTEGER NOT NULL,
      site_id VARCHAR NOT NULL,
      site_description VARCHAR,
      site_city VARCHAR,
      site_state VARCHAR
    )
  `);

  await conn.run(`
    CREATE TABLE antenna (
      antenna_key INTEGER NOT NULL,
      antenna_id VARCHAR NOT NULL,
      site_key INTEGER NOT NULL,
      diameter DOUBLE,
      manufacturer VARCHAR,
      model VARCHAR,
      max_input_power DOUBLE,
      max_output_eirp DOUBLE
    )
  `);

  await conn.run(`
    CREATE TABLE frequency (
      frequency_key INTEGER NOT NULL,
      antenna_key INTEGER NOT NULL,
      polarization_code VARCHAR,
      eirp DOUBLE,
      eirp_density DOUBLE,
      emission VARCHAR,
      frequency_lower VARCHAR,
      frequency_upper VARCHAR,
      trans_mode VARCHAR,
      modulation VARCHAR
    )
  `);
}

/** Seed test data for callsign E000001 with two filings, one site, one antenna, two frequencies */
async function seedTestData(conn: DuckDBConnection): Promise<void> {
  // Filing 1: older SES filing
  await conn.run(
    `INSERT INTO filing VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      100,
      'SES-LIC-20230101-00001',
      'SES',
      'LIC',
      'E000001',
      'G',
      '2023-01-01',
      '2023-06-01',
      '2038-06-01',
      'Fixed earth station license',
      'Acme Satellite Corp',
      'Washington',
      'DC',
      'US',
    ] as DuckDBValue[],
  );

  // Filing 2: newer SES filing
  await conn.run(
    `INSERT INTO filing VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      200,
      'SES-MOD-20240601-00050',
      'SES',
      'MOD',
      'E000001',
      'P',
      '2024-06-01',
      null,
      null,
      'Modification to add antenna',
      'Acme Satellite Corp',
      'Washington',
      'DC',
      'US',
    ] as DuckDBValue[],
  );

  // Filing 3: SAT filing (different subsystem, same callsign — should be excluded)
  await conn.run(
    `INSERT INTO filing VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      300,
      'SAT-LOA-20240101-00010',
      'SAT',
      'LOA',
      'E000001',
      'G',
      '2024-01-01',
      '2024-03-01',
      '2039-03-01',
      'Satellite launch and operate',
      'Acme Satellite Corp',
      'Washington',
      'DC',
      'US',
    ] as DuckDBValue[],
  );

  // Site linked to filing 100
  await conn.run(`INSERT INTO site VALUES ($1, $2, $3, $4, $5, $6)`, [
    10,
    100,
    'SITE-A',
    'Main facility',
    'Arlington',
    'VA',
  ] as DuckDBValue[]);

  // Antenna linked to site 10
  await conn.run(
    `INSERT INTO antenna VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [1000, 'ANT-1', 10, 3.7, 'ViaSat', 'KA-3.7', 25.0, 52.5] as DuckDBValue[],
  );

  // Two frequencies on antenna 1000
  await conn.run(
    `INSERT INTO frequency VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      5000,
      1000,
      'L',
      45.0,
      -12.5,
      '36M0G7W',
      '29250.0000',
      '29500.0000',
      'T',
      'D',
    ] as DuckDBValue[],
  );
  await conn.run(
    `INSERT INTO frequency VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      5001,
      1000,
      'R',
      null,
      null,
      '36M0G7W',
      '19700.0000',
      '19950.0000',
      'R',
      'D',
    ] as DuckDBValue[],
  );
}

describe('earth station repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createTables(conn);
    await seedTestData(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('getEarthStationByCallsign', () => {
    it('returns info from the most recent SES filing', async () => {
      const info: EarthStationInfo | null = await getEarthStationByCallsign(
        conn,
        'E000001',
      );
      expect(info).not.toBeNull();
      expect(info!.callsign).toEqual('E000001');
      expect(info!.applicantName).toEqual('Acme Satellite Corp');
      expect(info!.applicantCity).toEqual('Washington');
      expect(info!.applicantState).toEqual('DC');
      expect(info!.applicantCountry).toEqual('US');
      // Most recent SES filing is SES-MOD-20240601-00050
      expect(info!.mostRecentFileNumber).toEqual('SES-MOD-20240601-00050');
      expect(info!.mostRecentStatus).toEqual('P');
    });

    it('returns null for unknown callsign', async () => {
      const info: EarthStationInfo | null = await getEarthStationByCallsign(
        conn,
        'NONEXISTENT',
      );
      expect(info).toBeNull();
    });

    it('excludes non-SES filings', async () => {
      // Delete SES filings, leaving only SAT filing with same callsign
      await conn.run(
        `DELETE FROM filing WHERE subsystem_code = 'SES' AND callsign = 'E000001'`,
      );
      const info: EarthStationInfo | null = await getEarthStationByCallsign(
        conn,
        'E000001',
      );
      expect(info).toBeNull();
    });
  });

  describe('getEarthStationFilings', () => {
    it('returns paginated SES filings for callsign', async () => {
      const result: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'E000001', {});
      expect(result.totalRows).toEqual(2);
      expect(result.data).toHaveLength(2);
      expect(result.data.every((f) => f.fileNumber.startsWith('SES-'))).toEqual(
        true,
      );
    });

    it('excludes non-SES filings from results', async () => {
      const result: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'E000001', {});
      const fileNumbers: string[] = result.data.map((f) => f.fileNumber);
      expect(fileNumbers).not.toContain('SAT-LOA-20240101-00010');
    });

    it('respects page size', async () => {
      const result: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'E000001', { pageSize: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.totalRows).toEqual(2);
      expect(result.totalPages).toEqual(2);
    });

    it('returns correct second page', async () => {
      const page1: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'E000001', {
          pageSize: 1,
          order: 'asc',
        });
      const page2: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'E000001', {
          page: 2,
          pageSize: 1,
          order: 'asc',
        });
      expect(page1.data[0]!.fileNumber).not.toEqual(page2.data[0]!.fileNumber);
      expect(page2.page).toEqual(2);
    });

    it('returns empty data for unknown callsign', async () => {
      const result: PaginatedResponse<EarthStationFiling> =
        await getEarthStationFilings(conn, 'NONEXISTENT', {});
      expect(result.totalRows).toEqual(0);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('getEarthStationAntennas', () => {
    it('returns antennas with nested frequencies', async () => {
      const antennas: EarthStationAntenna[] = await getEarthStationAntennas(
        conn,
        'E000001',
      );
      expect(antennas).toHaveLength(1);

      const ant = antennas[0]!;
      expect(ant.antennaKey).toEqual(1000);
      expect(ant.antennaId).toEqual('ANT-1');
      expect(ant.diameter).toEqual(3.7);
      expect(ant.manufacturer).toEqual('ViaSat');
      expect(ant.model).toEqual('KA-3.7');
      expect(ant.maxInputPower).toEqual(25.0);
      expect(ant.maxOutputEirp).toEqual(52.5);

      expect(ant.frequencies).toHaveLength(2);
      expect(ant.frequencies[0]!.frequencyKey).toEqual(5000);
      expect(ant.frequencies[0]!.polarizationCode).toEqual('L');
      expect(ant.frequencies[0]!.eirp).toEqual(45.0);
      expect(ant.frequencies[0]!.frequencyLower).toEqual('29250.0000');
      expect(ant.frequencies[0]!.frequencyUpper).toEqual('29500.0000');

      expect(ant.frequencies[1]!.frequencyKey).toEqual(5001);
      expect(ant.frequencies[1]!.polarizationCode).toEqual('R');
      expect(ant.frequencies[1]!.eirp).toBeNull();
    });

    it('returns empty array for callsign with no antennas', async () => {
      const antennas: EarthStationAntenna[] = await getEarthStationAntennas(
        conn,
        'NONEXISTENT',
      );
      expect(antennas).toHaveLength(0);
    });

    it('returns antenna with empty frequencies if none exist', async () => {
      // Add a second antenna with no frequencies
      await conn.run(
        `INSERT INTO antenna VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [1001, 'ANT-2', 10, 2.4, null, null, null, null] as DuckDBValue[],
      );

      const antennas: EarthStationAntenna[] = await getEarthStationAntennas(
        conn,
        'E000001',
      );
      expect(antennas).toHaveLength(2);

      const noFreqAnt = antennas.find((a) => a.antennaKey === 1001);
      expect(noFreqAnt).toBeDefined();
      expect(noFreqAnt!.frequencies).toHaveLength(0);
    });
  });

  describe('getEarthStationStats', () => {
    it('returns correct stats for a callsign with filings and antennas', async () => {
      const stats: EarthStationStats = await getEarthStationStats(
        conn,
        'E000001',
      );
      expect(stats.totalFilingCount).toEqual(2);
      expect(stats.antennaCount).toEqual(1);
      // Most recent SES filing date is 2024-06-01
      expect(stats.mostRecentFilingDate).not.toBeNull();
      expect(stats.mostRecentFilingDate!).toContain('2024');
    });

    it('returns zero counts for unknown callsign', async () => {
      const stats: EarthStationStats = await getEarthStationStats(
        conn,
        'NONEXISTENT',
      );
      expect(stats.totalFilingCount).toEqual(0);
      expect(stats.mostRecentFilingDate).toBeNull();
      expect(stats.antennaCount).toEqual(0);
    });

    it('excludes non-SES filings from count', async () => {
      const stats: EarthStationStats = await getEarthStationStats(
        conn,
        'E000001',
      );
      // Only 2 SES filings, not the SAT filing
      expect(stats.totalFilingCount).toEqual(2);
    });
  });
});
