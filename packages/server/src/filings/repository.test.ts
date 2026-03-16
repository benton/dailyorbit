import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFilingByFileNumber } from './repository.ts';
import type { FilingDetail } from './types.ts';

/** Minimal schema for all tables needed by getFilingByFileNumber */
const SETUP_SQL: string = `
  CREATE TABLE filing (
    filing_key INTEGER NOT NULL PRIMARY KEY,
    file_number VARCHAR NOT NULL,
    subsystem_code VARCHAR NOT NULL DEFAULT '',
    app_type_code VARCHAR NOT NULL DEFAULT '',
    status_code VARCHAR,
    callsign VARCHAR,
    address_attention VARCHAR,
    applicant_frn VARCHAR,
    date_filed TIMESTAMP,
    date_signed TIMESTAMP,
    date_grant TIMESTAMP,
    date_begin TIMESTAMP,
    date_expire TIMESTAMP,
    last_action VARCHAR,
    last_action_date TIMESTAMP,
    brief_description VARCHAR,
    description VARCHAR,
    da_number VARCHAR,
    red_light_status VARCHAR,
    streamlined VARCHAR,
    environmental_impact VARCHAR,
    nature_of_service VARCHAR,
    transferor_name VARCHAR,
    transferee_name VARCHAR,
    icfs_last_fetched_at TIMESTAMP,
    company_id INTEGER
  );

  CREATE TABLE status_code (
    status_code VARCHAR NOT NULL PRIMARY KEY,
    status_text VARCHAR
  );

  CREATE TABLE subsystem_code (
    subsystem_code VARCHAR NOT NULL PRIMARY KEY,
    description VARCHAR
  );

  CREATE TABLE app_type_code (
    app_type_code VARCHAR NOT NULL PRIMARY KEY,
    application_type VARCHAR
  );

  CREATE TABLE attachment (
    attachment_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    source VARCHAR DEFAULT 'attachment',
    attachment_name VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    download_url VARCHAR NOT NULL,
    download_status VARCHAR NOT NULL DEFAULT 'pending',
    content_type VARCHAR,
    file_size_bytes BIGINT,
    summary TEXT
  );

  CREATE TABLE petition_to_deny (
    filing_key INTEGER NOT NULL,
    filed_by VARCHAR,
    date_filed TIMESTAMP,
    description VARCHAR
  );

  CREATE TABLE pleading (
    pleading_key INTEGER,
    filing_key INTEGER,
    file_number VARCHAR,
    icfs_sys_id VARCHAR,
    pleading_number VARCHAR,
    pleading_type VARCHAR,
    filer_name VARCHAR,
    created_on TIMESTAMP,
    exhibit_attachment_html VARCHAR,
    ingested_at TIMESTAMP DEFAULT current_timestamp
  );

  CREATE TABLE space_station (
    space_station_key INTEGER NOT NULL PRIMARY KEY,
    us_name VARCHAR NOT NULL,
    itu_name VARCHAR,
    orbit_location DOUBLE,
    "verbose" VARCHAR,
    inactive_date TIMESTAMP
  );

  CREATE TABLE company (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    parent_company_id INTEGER,
    stock_ticker VARCHAR,
    stock_exchange VARCHAR,
    industry VARCHAR,
    logo_url VARCHAR,
    website VARCHAR,
    description VARCHAR,
    gleif_lei VARCHAR,
    wikidata_id VARCHAR,
    created_at TIMESTAMP DEFAULT current_timestamp,
    updated_at TIMESTAMP DEFAULT current_timestamp
  );
`;

/** Seed lookup tables with test data */
const SEED_LOOKUPS_SQL: string = `
  INSERT INTO status_code (status_code, status_text) VALUES ('G', 'Granted');
  INSERT INTO status_code (status_code, status_text) VALUES ('P', 'Pending');
  INSERT INTO subsystem_code (subsystem_code, description) VALUES ('SAT', 'Satellite Space Station');
  INSERT INTO subsystem_code (subsystem_code, description) VALUES ('SES', 'Satellite Earth Station');
  INSERT INTO app_type_code (app_type_code, application_type) VALUES ('LOA', 'Launch and Operate Authority');
  INSERT INTO app_type_code (app_type_code, application_type) VALUES ('REG', 'Registration');
`;

const SAT_FILING_SQL: string = `
  INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code,
    status_code, callsign, address_attention, applicant_frn, date_filed,
    brief_description, da_number)
  VALUES (100, 'SAT-LOA-20250221-00050', 'SAT', 'LOA',
    'G', 'ICEYE-X1', 'ICEYE US, Inc.', '0030543268', '2025-02-21',
    'ICEYE seeks authority to launch and operate', '25-346')
`;

const SES_FILING_SQL: string = `
  INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code,
    status_code, callsign, address_attention, date_filed)
  VALUES (200, 'SES-REG-20250301-00010', 'SES', 'REG',
    'P', 'E120456', 'Example Telecom Corp.', '2025-03-01')
`;

const SPACE_STATION_SQL: string = `
  INSERT INTO space_station (space_station_key, us_name, itu_name, orbit_location)
  VALUES (500, 'ICEYE-X1', 'ICEYE-1', 97.5)
`;

describe('getFilingByFileNumber', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(SETUP_SQL);
    await conn.run(SEED_LOOKUPS_SQL);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns null for a non-existent file number', async () => {
    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-99990101-00001',
    );
    expect(result).toBeNull();
  });

  it('returns the filing with joined lookup labels', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    expect(result).not.toBeNull();
    expect(result!.dataSource).toEqual('ibfs-legacy');
    expect(result!.filingKey).toEqual(100);
    expect(result!.fileNumber).toEqual('SAT-LOA-20250221-00050');
    expect(result!.subsystemCode).toEqual('SAT');
    expect(result!.subsystemLabel).toEqual('Satellite Space Station');
    expect(result!.appTypeCode).toEqual('LOA');
    expect(result!.appTypeLabel).toEqual('Launch and Operate Authority');
    expect(result!.statusCode).toEqual('G');
    expect(result!.statusText).toEqual('Granted');
    expect(result!.applicantName).toEqual('ICEYE US, Inc.');
    expect(result!.applicantFrn).toEqual('0030543268');
    expect(result!.daNumber).toEqual('25-346');
  });

  it('reports dataSource as icfs when icfs_last_fetched_at is set', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);
    await conn.run(
      `UPDATE filing SET icfs_last_fetched_at = '2026-03-15 12:00:00' WHERE filing_key = 100`,
    );

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );
    expect(result!.dataSource).toEqual('icfs');
  });

  it('includes attachments associated with the filing', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);
    await conn.run(`
      INSERT INTO attachment (attachment_key, filing_key, file_number,
        attachment_name, description, download_url, download_status, content_type, file_size_bytes)
      VALUES
        (1001, 100, 'SAT-LOA-20250221-00050', 'application.pdf', 'Main application',
         'https://example.com/app.pdf', 'downloaded', 'application/pdf', 524288),
        (1002, 100, 'SAT-LOA-20250221-00050', 'exhibit-a.pdf', 'Technical exhibit',
         'https://example.com/exhibit.pdf', 'pending', NULL, NULL)
    `);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    expect(result!.attachments).toHaveLength(2);
    expect(result!.attachments[0]!.attachmentKey).toEqual(1001);
    expect(result!.attachments[0]!.attachmentName).toEqual('application.pdf');
    expect(result!.attachments[0]!.contentType).toEqual('application/pdf');
    expect(result!.attachments[0]!.fileSizeBytes).toEqual(524288);
    expect(result!.attachments[1]!.attachmentKey).toEqual(1002);
    expect(result!.attachments[1]!.downloadStatus).toEqual('pending');
    expect(result!.attachments[1]!.contentType).toBeNull();
  });

  it('includes petitions/comments associated with the filing', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);
    await conn.run(`
      INSERT INTO pleading (pleading_key, filing_key, file_number, filer_name, created_on, pleading_type, pleading_number)
      VALUES
        (1, 100, 'SAT-LOA-20250221-00050', 'Competing Corp.', '2025-03-15', 'PETITION', 'PC0001'),
        (2, 100, 'SAT-LOA-20250221-00050', 'Industry Alliance', '2025-03-20', 'COMMENT', 'PC0002')
    `);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    expect(result!.petitions).toHaveLength(2);
    expect(result!.petitions[0]!.partyName).toEqual('Competing Corp.');
    expect(result!.petitions[0]!.pleadingType).toEqual('PETITION');
    expect(result!.petitions[1]!.partyName).toEqual('Industry Alliance');
  });

  it('resolves related space station for SAT filings', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    expect(result!.relatedSpaceStation).not.toBeNull();
    expect(result!.relatedSpaceStation!.spaceStationKey).toEqual(500);
    expect(result!.relatedSpaceStation!.usName).toEqual('ICEYE-X1');
    expect(result!.relatedSpaceStation!.ituName).toEqual('ICEYE-1');
    expect(result!.relatedSpaceStation!.orbitLocation).toEqual('97.5');
    expect(result!.relatedEarthStationCallsign).toBeNull();
  });

  it('resolves related earth station callsign for SES filings', async () => {
    await conn.run(SES_FILING_SQL);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SES-REG-20250301-00010',
    );

    expect(result!.relatedEarthStationCallsign).toEqual('E120456');
    expect(result!.relatedSpaceStation).toBeNull();
    expect(result!.subsystemLabel).toEqual('Satellite Earth Station');
    expect(result!.statusText).toEqual('Pending');
  });

  it('returns empty arrays when no attachments or petitions exist', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    expect(result!.attachments).toEqual([]);
    expect(result!.petitions).toEqual([]);
  });

  it('handles filing with no lookup table matches gracefully', async () => {
    await conn.run(`
      INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code,
        status_code, callsign, address_attention)
      VALUES (300, 'ITC-214-20250401-00001', 'ITC', '214',
        'XYZ', 'C0001', 'Unknown Corp.')
    `);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'ITC-214-20250401-00001',
    );

    expect(result).not.toBeNull();
    expect(result!.subsystemLabel).toBeNull();
    expect(result!.appTypeLabel).toBeNull();
    expect(result!.statusText).toBeNull();
    expect(result!.relatedSpaceStation).toBeNull();
    expect(result!.relatedEarthStationCallsign).toBeNull();
  });

  it('does not set earth station callsign for non-SES filings with a callsign', async () => {
    await conn.run(SAT_FILING_SQL);
    await conn.run(SPACE_STATION_SQL);

    const result: FilingDetail | null = await getFilingByFileNumber(
      conn,
      'SAT-LOA-20250221-00050',
    );

    // SAT filing has callsign ICEYE-X1 but should NOT set relatedEarthStationCallsign
    expect(result!.callsign).toEqual('ICEYE-X1');
    expect(result!.relatedEarthStationCallsign).toBeNull();
  });
});
