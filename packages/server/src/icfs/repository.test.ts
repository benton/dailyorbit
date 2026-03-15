import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPleadingTable,
  icfsAttachmentsToMetadata,
  icfsPleadingsToRows,
  migrateLegacyPetitions,
  parseAppType,
  parseLegacyFilingKey,
  parseSubsystem,
  sysIdToInt,
  upsertIcfsFiling,
  upsertPleadings,
} from './repository.ts';
import type { PleadingRow } from './repository.ts';
import { ensureIcfsColumns } from './schema.ts';
import type { FileNumber } from '../lib/file-number.ts';
import type {
  IcfsAttachment,
  IcfsFilingDetail,
  IcfsFilingSummary,
  IcfsPleading,
} from './types.ts';

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
    const { ensureCompanyTables, ensureCompanyFk } =
      await import('../companies/schema.ts');
    await ensureCompanyTables(conn);
    await ensureCompanyFk(conn);
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

describe('sysIdToInt', () => {
  it('produces a deterministic positive 32-bit integer', () => {
    const result: number = sysIdToInt('abc123def456', 0);
    expect(result).toEqual(sysIdToInt('abc123def456', 0));
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });

  it('produces different values for different suffixes', () => {
    const a: number = sysIdToInt('same-sys-id', 0);
    const b: number = sysIdToInt('same-sys-id', 1);
    expect(a).not.toEqual(b);
  });

  it('produces different values for different sysIds', () => {
    const a: number = sysIdToInt('id-aaa', 0);
    const b: number = sysIdToInt('id-bbb', 0);
    expect(a).not.toEqual(b);
  });
});

describe('icfsAttachmentsToMetadata', () => {
  const FILE_NUMBER: FileNumber = 'SAT-LOA-20250221-00050' as FileNumber;
  const FILING_KEY: number = 520666;

  it('returns empty array for empty attachments', () => {
    expect(icfsAttachmentsToMetadata([], FILING_KEY, FILE_NUMBER)).toEqual([]);
  });

  it('creates one row per link', () => {
    const attachments: IcfsAttachment[] = [
      {
        sysId: 'att-sys-001',
        documentName: 'Application Filing',
        attachmentType: 'html_and_pdf',
        links: [
          { displayValue: 'PDF', url: 'https://example.com/doc.pdf' },
          { displayValue: 'HTML', url: 'https://example.com/doc.html' },
        ],
      },
    ];
    const result = icfsAttachmentsToMetadata(
      attachments,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      attachmentKey: sysIdToInt('att-sys-001', 0),
      filingKey: FILING_KEY,
      fileNumber: FILE_NUMBER,
      source: 'attachment',
      attachmentName: 'Application Filing',
      description: 'PDF',
      downloadUrl: 'https://example.com/doc.pdf',
    });
    expect(result[1]).toEqual({
      attachmentKey: sysIdToInt('att-sys-001', 1),
      filingKey: FILING_KEY,
      fileNumber: FILE_NUMBER,
      source: 'attachment',
      attachmentName: 'Application Filing',
      description: 'HTML',
      downloadUrl: 'https://example.com/doc.html',
    });
  });

  it('handles multiple attachments with multiple links', () => {
    const attachments: IcfsAttachment[] = [
      {
        sysId: 'att-001',
        documentName: 'Doc A',
        attachmentType: 'pdf',
        links: [{ displayValue: 'PDF', url: 'https://example.com/a.pdf' }],
      },
      {
        sysId: 'att-002',
        documentName: 'Doc B',
        attachmentType: 'html_and_pdf',
        links: [
          { displayValue: 'PDF', url: 'https://example.com/b.pdf' },
          { displayValue: 'HTML', url: 'https://example.com/b.html' },
        ],
      },
    ];
    const result = icfsAttachmentsToMetadata(
      attachments,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.attachmentName)).toEqual([
      'Doc A',
      'Doc B',
      'Doc B',
    ]);
  });

  it('produces unique attachment keys across all links', () => {
    const attachments: IcfsAttachment[] = [
      {
        sysId: 'att-001',
        documentName: 'Doc A',
        attachmentType: 'html_and_pdf',
        links: [
          { displayValue: 'PDF', url: 'https://example.com/a.pdf' },
          { displayValue: 'HTML', url: 'https://example.com/a.html' },
        ],
      },
      {
        sysId: 'att-002',
        documentName: 'Doc B',
        attachmentType: 'pdf',
        links: [{ displayValue: 'PDF', url: 'https://example.com/b.pdf' }],
      },
    ];
    const result = icfsAttachmentsToMetadata(
      attachments,
      FILING_KEY,
      FILE_NUMBER,
    );
    const keys: number[] = result.map((r) => r.attachmentKey);
    expect(new Set(keys).size).toEqual(keys.length);
  });

  it('is idempotent — same input produces same keys', () => {
    const attachments: IcfsAttachment[] = [
      {
        sysId: 'att-stable',
        documentName: 'Stable Doc',
        attachmentType: 'pdf',
        links: [{ displayValue: 'PDF', url: 'https://example.com/s.pdf' }],
      },
    ];
    const run1 = icfsAttachmentsToMetadata(
      attachments,
      FILING_KEY,
      FILE_NUMBER,
    );
    const run2 = icfsAttachmentsToMetadata(
      attachments,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(run1).toEqual(run2);
  });
});

describe('icfsPleadingsToRows', () => {
  const FILE_NUMBER: FileNumber = 'SAT-LOA-20250221-00050' as FileNumber;
  const FILING_KEY: number = 520666;

  it('returns empty array for empty pleadings', () => {
    expect(icfsPleadingsToRows([], FILING_KEY, FILE_NUMBER)).toEqual([]);
  });

  it('maps pleading fields to row columns', () => {
    const pleadings: IcfsPleading[] = [
      {
        number: 'PC0106846',
        sysId: '14f75dbe97393e108031b22de053afb5',
        pleadingType: 'LETTER',
        filerName: 'Nate Woodford',
        createdOn: '2025-12-17 07:23:47',
        exhibitAttachmentHtml: '<a href="...">exhibit</a>',
      },
    ];
    const rows: PleadingRow[] = icfsPleadingsToRows(
      pleadings,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      pleadingKey: sysIdToInt('14f75dbe97393e108031b22de053afb5', 0),
      filingKey: FILING_KEY,
      fileNumber: FILE_NUMBER,
      icfsSysId: '14f75dbe97393e108031b22de053afb5',
      pleadingNumber: 'PC0106846',
      pleadingType: 'LETTER',
      filerName: 'Nate Woodford',
      createdOn: '2025-12-17 07:23:47',
      exhibitAttachmentHtml: '<a href="...">exhibit</a>',
    });
  });

  it('produces deterministic keys — idempotent', () => {
    const pleadings: IcfsPleading[] = [
      {
        number: 'PC001',
        sysId: 'sys-stable',
        pleadingType: 'COMMENT',
        filerName: 'Test Filer',
        createdOn: '2025-01-01',
        exhibitAttachmentHtml: '',
      },
    ];
    const run1: PleadingRow[] = icfsPleadingsToRows(
      pleadings,
      FILING_KEY,
      FILE_NUMBER,
    );
    const run2: PleadingRow[] = icfsPleadingsToRows(
      pleadings,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(run1).toEqual(run2);
  });

  it('produces unique keys for different pleadings', () => {
    const pleadings: IcfsPleading[] = [
      {
        number: 'PC001',
        sysId: 'sys-aaa',
        pleadingType: 'COMMENT',
        filerName: 'Filer A',
        createdOn: '2025-01-01',
        exhibitAttachmentHtml: '',
      },
      {
        number: 'PC002',
        sysId: 'sys-bbb',
        pleadingType: 'LETTER',
        filerName: 'Filer B',
        createdOn: '2025-01-02',
        exhibitAttachmentHtml: '',
      },
    ];
    const rows: PleadingRow[] = icfsPleadingsToRows(
      pleadings,
      FILING_KEY,
      FILE_NUMBER,
    );
    const keys: number[] = rows.map((r: PleadingRow) => r.pleadingKey);
    expect(new Set(keys).size).toEqual(keys.length);
  });

  it('normalizes empty createdOn and exhibitAttachmentHtml to null', () => {
    const pleadings: IcfsPleading[] = [
      {
        number: 'PC001',
        sysId: 'sys-null-test',
        pleadingType: 'PETITION',
        filerName: 'Filer',
        createdOn: '',
        exhibitAttachmentHtml: '',
      },
    ];
    const rows: PleadingRow[] = icfsPleadingsToRows(
      pleadings,
      FILING_KEY,
      FILE_NUMBER,
    );
    expect(rows[0]!.createdOn).toBeNull();
    expect(rows[0]!.exhibitAttachmentHtml).toBeNull();
  });
});

describe('upsertPleadings', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createPleadingTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  const FILE_NUMBER: FileNumber = 'SAT-LOA-20250221-00050' as FileNumber;
  const FILING_KEY: number = 520666;

  function makeRow(overrides: Partial<PleadingRow> = {}): PleadingRow {
    return {
      pleadingKey: sysIdToInt('test-sys-id', 0),
      filingKey: FILING_KEY,
      fileNumber: FILE_NUMBER,
      icfsSysId: 'test-sys-id',
      pleadingNumber: 'PC001',
      pleadingType: 'COMMENT',
      filerName: 'Test Filer',
      createdOn: '2025-06-15 10:00:00',
      exhibitAttachmentHtml: null,
      ...overrides,
    };
  }

  it('inserts new pleading rows', async () => {
    const rows: PleadingRow[] = [makeRow()];
    const result = await upsertPleadings(conn, rows);
    expect(result).toEqual({ inserted: 1, existing: 0 });

    const reader = await conn.runAndReadAll(`SELECT * FROM pleading`);
    const dbRows = reader.getRowObjectsJS();
    expect(dbRows).toHaveLength(1);
    expect(String(dbRows[0]!.filer_name)).toEqual('Test Filer');
    expect(String(dbRows[0]!.pleading_type)).toEqual('COMMENT');
  });

  it('deduplicates on re-insert by pleading_key', async () => {
    const rows: PleadingRow[] = [makeRow()];
    await upsertPleadings(conn, rows);
    const result = await upsertPleadings(conn, rows);
    expect(result).toEqual({ inserted: 0, existing: 1 });

    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM pleading`,
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
  });

  it('inserts multiple distinct rows', async () => {
    const rows: PleadingRow[] = [
      makeRow({
        pleadingKey: sysIdToInt('sys-1', 0),
        icfsSysId: 'sys-1',
        pleadingNumber: 'PC001',
      }),
      makeRow({
        pleadingKey: sysIdToInt('sys-2', 0),
        icfsSysId: 'sys-2',
        pleadingNumber: 'PC002',
      }),
    ];
    const result = await upsertPleadings(conn, rows);
    expect(result).toEqual({ inserted: 2, existing: 0 });
  });
});

describe('migrateLegacyPetitions', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(CREATE_FILING_TABLE);
    await createPleadingTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns 0 when petition_to_deny table does not exist', async () => {
    const count: number = await migrateLegacyPetitions(conn);
    expect(count).toEqual(0);
  });

  it('migrates legacy rows into pleading table', async () => {
    // Create legacy table and insert test data
    await conn.run(`
      CREATE TABLE petition_to_deny (
        filing_key INTEGER NOT NULL,
        filed_by VARCHAR,
        date_filed TIMESTAMP,
        description VARCHAR
      )
    `);
    // Insert a filing so we can resolve the file_number
    await conn.run(
      `INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code)
       VALUES (100, 'SAT-LOA-20200101-00001', 'SAT', 'LOA')`,
    );
    await conn.run(
      `INSERT INTO petition_to_deny (filing_key, filed_by, date_filed, description)
       VALUES (100, 'Jane Doe', '2020-03-15', 'Opposition to grant')`,
    );

    const count: number = await migrateLegacyPetitions(conn);
    expect(count).toEqual(1);

    const reader = await conn.runAndReadAll(`SELECT * FROM pleading`);
    const rows = reader.getRowObjectsJS();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.filer_name)).toEqual('Jane Doe');
    expect(String(rows[0]!.pleading_type)).toEqual('PETITION');
    expect(String(rows[0]!.icfs_sys_id)).toEqual('ibfs-legacy');
    expect(String(rows[0]!.file_number)).toEqual('SAT-LOA-20200101-00001');
  });

  it('is idempotent — does not duplicate on re-run', async () => {
    await conn.run(`
      CREATE TABLE petition_to_deny (
        filing_key INTEGER NOT NULL,
        filed_by VARCHAR,
        date_filed TIMESTAMP,
        description VARCHAR
      )
    `);
    await conn.run(
      `INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code)
       VALUES (100, 'SAT-LOA-20200101-00001', 'SAT', 'LOA')`,
    );
    await conn.run(
      `INSERT INTO petition_to_deny (filing_key, filed_by, date_filed, description)
       VALUES (100, 'Jane Doe', '2020-03-15', 'Opposition')`,
    );

    await migrateLegacyPetitions(conn);
    const secondRun: number = await migrateLegacyPetitions(conn);
    expect(secondRun).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM pleading`,
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
  });
});
