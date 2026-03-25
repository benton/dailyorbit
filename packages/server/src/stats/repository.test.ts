import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  getApplicantFilings,
  getAttachmentStats,
  getDatasetStats,
  getDbSizeBytes,
  getFilingCount,
  getFilingsBySubsystem,
  getRandomOrbitLocation,
  getYearlyFilingVolume,
  getTopApplicants,
} from './repository.ts';

const CREATE_FILING_TABLE: string = `
  CREATE TABLE IF NOT EXISTS filing (
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    subsystem_code VARCHAR NOT NULL,
    app_type_code VARCHAR NOT NULL,
    date_filed DATE,
    address_attention VARCHAR,
    status_code VARCHAR
  )`;

const CREATE_SPACE_STATION_TABLE: string = `
  CREATE TABLE IF NOT EXISTS space_station (
    space_station_key INTEGER NOT NULL PRIMARY KEY,
    us_name VARCHAR NOT NULL,
    itu_name VARCHAR,
    orbit_location VARCHAR,
    "verbose" VARCHAR,
    inactive_date TIMESTAMP
  )`;

const CREATE_ATTACHMENT_TABLE: string = `
  CREATE TABLE IF NOT EXISTS attachment (
    attachment_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    attachment_name VARCHAR NOT NULL,
    download_status VARCHAR NOT NULL DEFAULT 'pending',
    file_size_bytes BIGINT
  )`;

describe('stats repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_FILING_TABLE);
    await conn.run(CREATE_ATTACHMENT_TABLE);
    await conn.run(CREATE_SPACE_STATION_TABLE);
  });

  afterEach(() => {
    conn.closeSync();
    db.closeSync();
  });

  describe('getFilingCount', () => {
    it('returns 0 for an empty table', async () => {
      const count: number = await getFilingCount(conn);
      expect(count).toEqual(0);
    });

    it('returns the total number of filings', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', NULL, NULL),
        (2, 'SES-STA-20240201-00002', 'SES', 'STA', '2024-02-01', NULL, NULL),
        (3, 'SAT-MOD-20240301-00003', 'SAT', 'MOD', '2024-03-01', NULL, NULL)`);
      const count: number = await getFilingCount(conn);
      expect(count).toEqual(3);
    });
  });

  describe('getFilingsBySubsystem', () => {
    it('returns empty array for an empty table', async () => {
      const result = await getFilingsBySubsystem(conn);
      expect(result).toEqual([]);
    });

    it('returns grouped counts sorted descending by count', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', NULL, NULL),
        (2, 'SAT-MOD-20240201-00002', 'SAT', 'MOD', '2024-02-01', NULL, NULL),
        (3, 'SAT-STA-20240301-00003', 'SAT', 'STA', '2024-03-01', NULL, NULL),
        (4, 'SES-STA-20240101-00004', 'SES', 'STA', '2024-01-01', NULL, NULL),
        (5, 'ITC-214-20240101-00005', 'ITC', '214', '2024-01-01', NULL, NULL)`);
      const result = await getFilingsBySubsystem(conn);
      expect(result).toEqual([
        { subsystem_code: 'SAT', count: 3 },
        { subsystem_code: 'ITC', count: 1 },
        { subsystem_code: 'SES', count: 1 },
      ]);
    });
  });

  describe('getAttachmentStats', () => {
    it('returns zero stats for an empty table', async () => {
      const stats = await getAttachmentStats(conn);
      expect(stats).toEqual({
        total: 0,
        downloaded: 0,
        pending: 0,
        failed: 0,
        total_bytes: 0,
      });
    });

    it('returns counts by status and total bytes', async () => {
      await conn.run(`INSERT INTO attachment VALUES
        (1, 1, 'SAT-LOA-20240101-00001', 'doc1.pdf', 'downloaded', 1024),
        (2, 1, 'SAT-LOA-20240101-00001', 'doc2.pdf', 'downloaded', 2048),
        (3, 2, 'SES-STA-20240201-00002', 'doc3.pdf', 'pending', NULL),
        (4, 2, 'SES-STA-20240201-00002', 'doc4.pdf', 'failed', NULL)`);
      const stats = await getAttachmentStats(conn);
      expect(stats).toEqual({
        total: 4,
        downloaded: 2,
        pending: 1,
        failed: 1,
        total_bytes: 3072,
      });
    });
  });

  describe('getDbSizeBytes', () => {
    it('returns 0 for a nonexistent path', async () => {
      const size: number = await getDbSizeBytes('/nonexistent/path.duckdb');
      expect(size).toEqual(0);
    });
  });

  describe('getDatasetStats', () => {
    it('aggregates all stats into a single object', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', NULL, NULL)`);
      await conn.run(`INSERT INTO attachment VALUES
        (1, 1, 'SAT-LOA-20240101-00001', 'doc.pdf', 'downloaded', 512)`);
      const stats = await getDatasetStats(conn, '/nonexistent/path.duckdb');
      expect(stats).toEqual({
        filing_count: 1,
        filings_by_subsystem: [{ subsystem_code: 'SAT', count: 1 }],
        attachment_stats: {
          total: 1,
          downloaded: 1,
          pending: 0,
          failed: 0,
          total_bytes: 512,
        },
        db_size_bytes: 0,
      });
    });
  });

  describe('getTopApplicants', () => {
    it('returns empty array when no filings have applicant names', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', NULL, NULL)`);
      const result = await getTopApplicants(conn);
      expect(result).toEqual([]);
    });

    it('returns applicants sorted by filing count descending', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', 'SpaceX', 'A'),
        (2, 'SAT-MOD-20240201-00002', 'SAT', 'MOD', '2024-02-01', 'SpaceX', 'A'),
        (3, 'SAT-STA-20240301-00003', 'SAT', 'STA', '2024-03-01', 'SpaceX', 'A'),
        (4, 'SES-STA-20240101-00004', 'SES', 'STA', '2024-01-01', 'SES S.A.', 'A'),
        (5, 'ITC-214-20240101-00005', 'ITC', '214', '2024-01-01', 'Viasat', 'A')`);
      const result = await getTopApplicants(conn);
      expect(result).toEqual([
        { id: 'applicant-0', name: 'SpaceX', filing_count: 3 },
        { id: 'applicant-1', name: 'SES S.A.', filing_count: 1 },
        { id: 'applicant-2', name: 'Viasat', filing_count: 1 },
      ]);
    });

    it('respects the limit parameter', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', 'SpaceX', NULL),
        (2, 'SAT-MOD-20240201-00002', 'SAT', 'MOD', '2024-02-01', 'SpaceX', NULL),
        (3, 'SES-STA-20240101-00003', 'SES', 'STA', '2024-01-01', 'SES S.A.', NULL),
        (4, 'ITC-214-20240101-00004', 'ITC', '214', '2024-01-01', 'Viasat', NULL)`);
      const result = await getTopApplicants(conn, 2);
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toEqual('SpaceX');
    });

    it('excludes filings with empty address_attention', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', '', NULL),
        (2, 'SAT-MOD-20240201-00002', 'SAT', 'MOD', '2024-02-01', 'SpaceX', NULL)`);
      const result = await getTopApplicants(conn);
      expect(result).toEqual([
        { id: 'applicant-0', name: 'SpaceX', filing_count: 1 },
      ]);
    });
  });

  describe('getApplicantFilings', () => {
    it('returns empty array for empty applicant list', async () => {
      const result = await getApplicantFilings(conn, []);
      expect(result).toEqual([]);
    });

    it('returns filings for specified applicants ordered by date descending', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', 'SpaceX', 'G'),
        (2, 'SAT-MOD-20240601-00002', 'SAT', 'MOD', '2024-06-01', 'SpaceX', 'A'),
        (3, 'SES-STA-20240301-00003', 'SES', 'STA', '2024-03-01', 'SES S.A.', NULL),
        (4, 'ITC-214-20240101-00004', 'ITC', '214', '2024-01-01', 'Viasat', NULL)`);
      const result = await getApplicantFilings(conn, ['SpaceX', 'SES S.A.']);
      expect(result).toEqual([
        {
          applicant_name: 'SpaceX',
          file_number: 'SAT-MOD-20240601-00002',
          subsystem_code: 'SAT',
          app_type_code: 'MOD',
          date_filed: '2024-06-01',
          status_code: 'A',
        },
        {
          applicant_name: 'SES S.A.',
          file_number: 'SES-STA-20240301-00003',
          subsystem_code: 'SES',
          app_type_code: 'STA',
          date_filed: '2024-03-01',
          status_code: null,
        },
        {
          applicant_name: 'SpaceX',
          file_number: 'SAT-LOA-20240101-00001',
          subsystem_code: 'SAT',
          app_type_code: 'LOA',
          date_filed: '2024-01-01',
          status_code: 'G',
        },
      ]);
    });

    it('handles filings with null date_filed', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', NULL, 'SpaceX', NULL)`);
      const result = await getApplicantFilings(conn, ['SpaceX']);
      expect(result).toEqual([
        {
          applicant_name: 'SpaceX',
          file_number: 'SAT-LOA-20240101-00001',
          subsystem_code: 'SAT',
          app_type_code: 'LOA',
          date_filed: null,
          status_code: null,
        },
      ]);
    });
  });

  describe('getYearlyFilingVolume', () => {
    it('returns empty array for an empty table', async () => {
      const result = await getYearlyFilingVolume(conn);
      expect(result).toEqual([]);
    });

    it('groups filings by year and subsystem, ordered by year then subsystem', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-15', NULL, NULL),
        (2, 'SAT-MOD-20240120-00002', 'SAT', 'MOD', '2024-06-20', NULL, NULL),
        (3, 'SES-STA-20240115-00003', 'SES', 'STA', '2024-01-15', NULL, NULL),
        (4, 'SAT-STA-20250215-00004', 'SAT', 'STA', '2025-02-15', NULL, NULL),
        (5, 'SES-REG-20250315-00005', 'SES', 'REG', '2025-03-15', NULL, NULL)`);
      const result = await getYearlyFilingVolume(conn);
      expect(result).toEqual([
        { year: '2024', subsystem_code: 'SAT', count: 2 },
        { year: '2024', subsystem_code: 'SES', count: 1 },
        { year: '2025', subsystem_code: 'SAT', count: 1 },
        { year: '2025', subsystem_code: 'SES', count: 1 },
      ]);
    });

    it('excludes filings with null date_filed', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SAT-LOA-20240101-00001', 'SAT', 'LOA', '2024-01-01', NULL, NULL),
        (2, 'SAT-MOD-20240201-00002', 'SAT', 'MOD', NULL, NULL, NULL)`);
      const result = await getYearlyFilingVolume(conn);
      expect(result).toEqual([
        { year: '2024', subsystem_code: 'SAT', count: 1 },
      ]);
    });

    it('excludes filings before 1970 and after current date', async () => {
      await conn.run(`INSERT INTO filing VALUES
        (1, 'SES-LOA-19600101-00001', 'SES', 'LOA', '1960-01-01', NULL, NULL),
        (2, 'SAT-LOA-19700101-00002', 'SAT', 'LOA', '1970-01-01', NULL, NULL),
        (3, 'SAT-MOD-20240601-00003', 'SAT', 'MOD', '2024-06-01', NULL, NULL),
        (4, 'SES-STA-88880808-00004', 'SES', 'STA', '8888-08-08', NULL, NULL)`);
      const result = await getYearlyFilingVolume(conn);
      expect(result).toEqual([
        { year: '1970', subsystem_code: 'SAT', count: 1 },
        { year: '2024', subsystem_code: 'SAT', count: 1 },
      ]);
    });
  });

  describe('getRandomOrbitLocation', () => {
    it('returns null when no active satellites exist', async () => {
      const result = await getRandomOrbitLocation(conn);
      expect(result).toEqual(null);
    });

    it('returns a random active satellite with orbit location', async () => {
      await conn.run(`INSERT INTO space_station VALUES
        (1, 'SATMEX-5', 'SATMEX-5', '116.8°W', NULL, NULL),
        (2, 'INACTIVE-SAT', 'INACTIVE', '90.0°E', NULL, '2020-01-01')`);
      const result = await getRandomOrbitLocation(conn);
      expect(result).toEqual({ name: 'SATMEX-5', location: '116.8°W' });
    });

    it('excludes satellites with null orbit_location', async () => {
      await conn.run(`INSERT INTO space_station VALUES
        (1, 'NO-ORBIT', 'NO-ORBIT', NULL, NULL, NULL)`);
      const result = await getRandomOrbitLocation(conn);
      expect(result).toEqual(null);
    });

    it('returns one of the active satellites when multiple exist', async () => {
      await conn.run(`INSERT INTO space_station VALUES
        (1, 'SAT-A', 'SAT-A', '100.0°W', NULL, NULL),
        (2, 'SAT-B', 'SAT-B', '50.0°E', NULL, NULL)`);
      const result = await getRandomOrbitLocation(conn);
      expect(result).not.toEqual(null);
      expect(['SAT-A', 'SAT-B']).toContain(result!.name);
      expect(['100.0°W', '50.0°E']).toContain(result!.location);
    });
  });
});
