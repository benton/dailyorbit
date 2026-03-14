import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseAppType,
  parseLegacyFilingKey,
  parseSubsystem,
  upsertIcfsFiling,
} from './repository.ts';
import { ensureIcfsColumns } from './schema.ts';
import type { IcfsFilingDetail, IcfsFilingSummary } from './types.ts';

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

function makeSummary(
  overrides: Partial<IcfsFilingSummary> = {},
): IcfsFilingSummary {
  return {
    fileNumber: 'SAT-LOA-20250221-00050',
    sysId: 'abc123',
    callSign: 'S3224',
    applicantName: 'ICEYE US, Inc.',
    applicantFrn: '0030543268',
    applicantStreet: '70 Discovery',
    applicantCity: 'Irvine',
    applicantState: 'CA',
    applicantZipCode: '92618',
    applicantCountry: '',
    contactName: 'George V. John',
    contactStreet: '555 Thirteenth St NW',
    contactCity: 'Washington',
    contactState: 'DC',
    contactZipCode: '20004',
    contactCountry: '',
    briefDescription: 'ICEYE seeks authority',
    natureOfService: '',
    status: 'Current',
    statusDate: '2025-04-18',
    submissionDate: '2025-02-21',
    grantDate: '2025-04-14',
    beginDate: '',
    expirationDate: '',
    lastAction: '',
    lastActionDate: '',
    afpnDate: '2025-03-07',
    actionPnDate: '2025-04-18',
    daNumber: '25-346',
    redLightStatus: 'No',
    streamlined: '',
    environmentalImpact: 'No',
    legacyFilingKey: '-520,666',
    releaseDate: '',
    adoptedDate: '',
    acceptedPnDaNumber: '',
    actionPnDaNumber: '',
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<IcfsFilingDetail> = {},
): IcfsFilingDetail {
  return {
    found: true,
    summary: makeSummary(),
    transferParties: null,
    serviceTypes: [],
    attachments: [],
    pleadings: [],
    ...overrides,
  };
}

describe('parseSubsystem', () => {
  it('extracts subsystem from standard file number', () => {
    expect(parseSubsystem('SAT-LOA-20250221-00050')).toEqual('SAT');
  });

  it('extracts subsystem from T/C file number', () => {
    expect(parseSubsystem('SAT-T/C-20250917-00287')).toEqual('SAT');
  });
});

describe('parseAppType', () => {
  it('extracts app type from standard file number', () => {
    expect(parseAppType('SAT-LOA-20250221-00050')).toEqual('LOA');
  });

  it('extracts T/C app type', () => {
    expect(parseAppType('SAT-T/C-20250917-00287')).toEqual('T/C');
  });
});

describe('parseLegacyFilingKey', () => {
  it('parses negative comma-formatted key', () => {
    expect(parseLegacyFilingKey('-520,666')).toEqual(-520666);
  });

  it('parses large negative key', () => {
    expect(parseLegacyFilingKey('-1,499,997,387')).toEqual(-1499997387);
  });

  it('returns null for empty string', () => {
    expect(parseLegacyFilingKey('')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseLegacyFilingKey('abc')).toBeNull();
  });
});

describe('upsertIcfsFiling', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_FILING_TABLE);
    await ensureIcfsColumns(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('inserts a new filing when file_number does not exist', async () => {
    const detail: IcfsFilingDetail = makeDetail();
    await upsertIcfsFiling(conn, detail);

    const reader = await conn.runAndReadAll(
      `SELECT * FROM filing WHERE file_number = 'SAT-LOA-20250221-00050'`,
    );
    const rows = reader.getRowObjectsJS();
    expect(rows.length).toEqual(1);

    const row = rows[0]!;
    expect(Number(row.filing_key)).toEqual(-520666);
    expect(String(row.applicant_frn)).toEqual('0030543268');
    expect(String(row.red_light_status)).toEqual('No');
    expect(String(row.icfs_sys_id)).toEqual('abc123');
    expect(String(row.subsystem_code)).toEqual('SAT');
    expect(String(row.app_type_code)).toEqual('LOA');
    expect(String(row.da_number)).toEqual('25-346');
  });

  it('updates existing filing with ICFS fields, preserving IBFS data', async () => {
    // Insert a pre-existing IBFS row
    await conn.run(
      `INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code, description)
       VALUES (-520666, 'SAT-LOA-20250221-00050', 'SAT', 'LOA', 'Original IBFS desc')`,
    );

    const detail: IcfsFilingDetail = makeDetail();
    await upsertIcfsFiling(conn, detail);

    const reader = await conn.runAndReadAll(
      `SELECT * FROM filing WHERE file_number = 'SAT-LOA-20250221-00050'`,
    );
    const rows = reader.getRowObjectsJS();
    expect(rows.length).toEqual(1);

    const row = rows[0]!;
    // ICFS fields populated
    expect(String(row.applicant_frn)).toEqual('0030543268');
    expect(String(row.red_light_status)).toEqual('No');
    expect(String(row.icfs_sys_id)).toEqual('abc123');
    // filing_key preserved
    expect(Number(row.filing_key)).toEqual(-520666);
  });

  it('populates transferor/transferee columns for transfer filings', async () => {
    const detail: IcfsFilingDetail = makeDetail({
      summary: makeSummary({
        fileNumber: 'SAT-T/C-20250917-00287',
        legacyFilingKey: '',
      }),
      transferParties: {
        transferorName: 'OldCo',
        transferorStreet: '100 Main St',
        transferorCity: 'New York',
        transferorZipCode: '10001',
        transfereeName: 'NewCo',
        transfereeStreet: '200 Broadway',
        transfereeCity: 'Boston',
        transfereeZipCode: '02101',
      },
    });

    await upsertIcfsFiling(conn, detail);

    const reader = await conn.runAndReadAll(
      `SELECT transferor_name, transferee_name, transferor_city, transferee_city
       FROM filing WHERE file_number = 'SAT-T/C-20250917-00287'`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.transferor_name)).toEqual('OldCo');
    expect(String(row.transferee_name)).toEqual('NewCo');
    expect(String(row.transferor_city)).toEqual('New York');
    expect(String(row.transferee_city)).toEqual('Boston');
  });

  it('sets icfs_last_fetched_at to a non-null timestamp', async () => {
    await upsertIcfsFiling(conn, makeDetail());

    const reader = await conn.runAndReadAll(
      `SELECT icfs_last_fetched_at FROM filing WHERE file_number = 'SAT-LOA-20250221-00050'`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(row.icfs_last_fetched_at).not.toBeNull();
    const fetchedAt: Date = new Date(String(row.icfs_last_fetched_at));
    expect(fetchedAt.getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it('generates a synthetic filing_key for new filings with no legacy key', async () => {
    const detail: IcfsFilingDetail = makeDetail({
      summary: makeSummary({
        fileNumber: 'SAT-LOA-20260101-00001',
        legacyFilingKey: '',
      }),
    });

    await upsertIcfsFiling(conn, detail);

    const reader = await conn.runAndReadAll(
      `SELECT filing_key FROM filing WHERE file_number = 'SAT-LOA-20260101-00001'`,
    );
    const key: number = Number(reader.getRowObjectsJS()[0]!.filing_key);
    // Synthetic key should be negative
    expect(key).toBeLessThan(0);
  });

  it('skips upsert when detail.found is false', async () => {
    const detail: IcfsFilingDetail = {
      found: false,
      summary: null,
      transferParties: null,
      serviceTypes: [],
      attachments: [],
      pleadings: [],
    };

    await upsertIcfsFiling(conn, detail);

    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM filing`,
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(0);
  });
});
