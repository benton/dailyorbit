import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { PaginatedRequest, PaginatedResponse } from '../lib/pagination.ts';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
} from '../lib/pagination.ts';
import type {
  AliasType,
  AttributionStats,
  Company,
  CompanyAlias,
  CompanyDetail,
  CompanyListItem,
  OwnershipEvent,
  OwnershipEventStatus,
  OwnershipEventType,
} from './types.ts';

// ── Sortable column whitelists ──────────────────────────────────────

const COMPANY_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'stock_ticker',
  'industry',
  'created_at',
]);

const FILING_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'file_number',
  'date_filed',
  'subsystem_code',
  'app_type_code',
  'status_code',
  'address_attention',
]);

// ── Row mappers ─────────────────────────────────────────────────────

function rowToCompany(r: Record<string, unknown>): Company {
  return {
    id: Number(r.id),
    name: String(r.name),
    parentCompanyId:
      r.parent_company_id != null ? Number(r.parent_company_id) : null,
    stockTicker: r.stock_ticker != null ? String(r.stock_ticker) : null,
    stockExchange: r.stock_exchange != null ? String(r.stock_exchange) : null,
    industry: r.industry != null ? String(r.industry) : null,
    logoUrl: r.logo_url != null ? String(r.logo_url) : null,
    website: r.website != null ? String(r.website) : null,
    description: r.description != null ? String(r.description) : null,
    gleifLei: r.gleif_lei != null ? String(r.gleif_lei) : null,
    wikidataId: r.wikidata_id != null ? String(r.wikidata_id) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToCompanyListItem(r: Record<string, unknown>): CompanyListItem {
  return {
    id: Number(r.id),
    name: String(r.name),
    parentName: r.parent_name != null ? String(r.parent_name) : null,
    filingCount: Number(r.filing_count ?? 0),
  };
}

function rowToAlias(r: Record<string, unknown>): CompanyAlias {
  return {
    companyId: Number(r.company_id),
    aliasName: String(r.alias_name),
    aliasType: String(r.alias_type) as AliasType,
  };
}

function rowToOwnershipEvent(r: Record<string, unknown>): OwnershipEvent {
  return {
    eventId: Number(r.event_id),
    filingFileNumber: String(r.filing_file_number),
    transferorCompanyId:
      r.transferor_company_id != null ? Number(r.transferor_company_id) : null,
    transfereeCompanyId:
      r.transferee_company_id != null ? Number(r.transferee_company_id) : null,
    effectiveDate: r.effective_date != null ? String(r.effective_date) : null,
    eventType: String(r.event_type) as OwnershipEventType,
    status: String(r.status) as OwnershipEventStatus,
    description: r.description != null ? String(r.description) : null,
  };
}

// ── Company CRUD ────────────────────────────────────────────────────

export async function createCompany(
  conn: DuckDBConnection,
  data: {
    name: string;
    parentCompanyId?: number | null;
    stockTicker?: string | null;
    stockExchange?: string | null;
    industry?: string | null;
    logoUrl?: string | null;
    website?: string | null;
    description?: string | null;
    gleifLei?: string | null;
    wikidataId?: string | null;
  },
): Promise<Company> {
  await conn.run(
    `INSERT INTO company (name, parent_company_id, stock_ticker, stock_exchange, industry, logo_url, website, description, gleif_lei, wikidata_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      data.name,
      data.parentCompanyId ?? null,
      data.stockTicker ?? null,
      data.stockExchange ?? null,
      data.industry ?? null,
      data.logoUrl ?? null,
      data.website ?? null,
      data.description ?? null,
      data.gleifLei ?? null,
      data.wikidataId ?? null,
    ] as DuckDBValue[],
  );

  // Fetch the created row (last inserted via sequence)
  const reader = await conn.runAndReadAll(
    `SELECT * FROM company WHERE id = (SELECT max(id) FROM company)`,
  );
  return rowToCompany(reader.getRowObjectsJS()[0]!);
}

export async function getCompanyById(
  conn: DuckDBConnection,
  id: number,
): Promise<Company | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM company WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToCompany(rows[0]!);
}

export async function getCompanyDetail(
  conn: DuckDBConnection,
  id: number,
): Promise<CompanyDetail | null> {
  const company: Company | null = await getCompanyById(conn, id);
  if (company == null) return null;

  // Aliases
  const aliasReader = await conn.runAndReadAll(
    `SELECT * FROM company_alias WHERE company_id = $1 ORDER BY alias_name`,
    [id] as DuckDBValue[],
  );
  const aliases: CompanyAlias[] = aliasReader.getRowObjectsJS().map(rowToAlias);

  // Subsidiaries
  const subReader = await conn.runAndReadAll(
    `SELECT c.id, c.name, p.name AS parent_name,
            (SELECT count(*) FROM filing f WHERE f.company_id = c.id)::INTEGER AS filing_count
     FROM company c
     LEFT JOIN company p ON p.id = c.parent_company_id
     WHERE c.parent_company_id = $1
     ORDER BY c.name`,
    [id] as DuckDBValue[],
  );
  const subsidiaries: CompanyListItem[] = subReader
    .getRowObjectsJS()
    .map(rowToCompanyListItem);

  // Parent
  let parent: CompanyListItem | null = null;
  if (company.parentCompanyId != null) {
    const parentReader = await conn.runAndReadAll(
      `SELECT c.id, c.name, p.name AS parent_name,
              (SELECT count(*) FROM filing f WHERE f.company_id = c.id)::INTEGER AS filing_count
       FROM company c
       LEFT JOIN company p ON p.id = c.parent_company_id
       WHERE c.id = $1`,
      [company.parentCompanyId] as DuckDBValue[],
    );
    const parentRows = parentReader.getRowObjectsJS();
    if (parentRows.length > 0) {
      parent = rowToCompanyListItem(parentRows[0]!);
    }
  }

  // Filing count (including subsidiaries)
  const countReader = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM filing
     WHERE company_id = $1 OR company_id IN (SELECT id FROM company WHERE parent_company_id = $1)`,
    [id] as DuckDBValue[],
  );
  const filingCount: number = Number(
    countReader.getRowObjectsJS()[0]?.cnt ?? 0,
  );

  // Ownership events
  const eventReader = await conn.runAndReadAll(
    `SELECT * FROM ownership_event
     WHERE transferor_company_id = $1 OR transferee_company_id = $1
     ORDER BY effective_date DESC NULLS LAST`,
    [id] as DuckDBValue[],
  );
  const ownershipEvents: OwnershipEvent[] = eventReader
    .getRowObjectsJS()
    .map(rowToOwnershipEvent);

  return {
    company,
    aliases,
    subsidiaries,
    parent,
    filingCount,
    ownershipEvents,
  };
}

export async function listCompanies(
  conn: DuckDBConnection,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<CompanyListItem>> {
  const baseSql: string = `
    SELECT c.id, c.name, p.name AS parent_name,
           (SELECT count(*) FROM filing f WHERE f.company_id = c.id)::INTEGER AS filing_count
    FROM company c
    LEFT JOIN company p ON p.id = c.parent_company_id`;

  const { sql, params, countSql, countParams } = buildPaginatedQuery(
    baseSql,
    [],
    pagination,
    COMPANY_SORTABLE_COLUMNS,
    'name',
  );

  const dataReader = await conn.runAndReadAll(sql, params);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data: CompanyListItem[] = dataReader
    .getRowObjectsJS()
    .map(rowToCompanyListItem);
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

export async function updateCompany(
  conn: DuckDBConnection,
  id: number,
  data: {
    name?: string;
    parentCompanyId?: number | null;
    stockTicker?: string | null;
    stockExchange?: string | null;
    industry?: string | null;
    logoUrl?: string | null;
    website?: string | null;
    description?: string | null;
    gleifLei?: string | null;
    wikidataId?: string | null;
  },
): Promise<Company | null> {
  const sets: string[] = [];
  const params: DuckDBValue[] = [];
  let idx: number = 1;

  const fields: Array<[string, unknown]> = [
    ['name', data.name],
    ['parent_company_id', data.parentCompanyId],
    ['stock_ticker', data.stockTicker],
    ['stock_exchange', data.stockExchange],
    ['industry', data.industry],
    ['logo_url', data.logoUrl],
    ['website', data.website],
    ['description', data.description],
    ['gleif_lei', data.gleifLei],
    ['wikidata_id', data.wikidataId],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      sets.push(`"${col}" = $${idx}`);
      params.push(val as DuckDBValue);
      idx++;
    }
  }

  if (sets.length === 0) return getCompanyById(conn, id);

  sets.push(`updated_at = current_timestamp`);
  params.push(id as DuckDBValue);

  await conn.run(
    `UPDATE company SET ${sets.join(', ')} WHERE id = $${idx}`,
    params,
  );

  return getCompanyById(conn, id);
}

// ── Alias operations ────────────────────────────────────────────────

export async function addAlias(
  conn: DuckDBConnection,
  companyId: number,
  aliasName: string,
  aliasType: AliasType = 'legal_name',
): Promise<void> {
  await conn.run(
    `INSERT INTO company_alias (company_id, alias_name, alias_type)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [companyId, aliasName, aliasType] as DuckDBValue[],
  );
}

export async function removeAlias(
  conn: DuckDBConnection,
  companyId: number,
  aliasName: string,
): Promise<void> {
  await conn.run(
    `DELETE FROM company_alias WHERE company_id = $1 AND alias_name = $2`,
    [companyId, aliasName] as DuckDBValue[],
  );
}

export async function getCompanyByAlias(
  conn: DuckDBConnection,
  name: string,
): Promise<Company | null> {
  // Tier 1: exact match
  const exactReader = await conn.runAndReadAll(
    `SELECT c.* FROM company c
     JOIN company_alias ca ON ca.company_id = c.id
     WHERE ca.alias_name = $1
     LIMIT 1`,
    [name] as DuckDBValue[],
  );
  const exactRows = exactReader.getRowObjectsJS();
  if (exactRows.length > 0) return rowToCompany(exactRows[0]!);

  // Tier 2: case-insensitive match
  const ilikeReader = await conn.runAndReadAll(
    `SELECT c.* FROM company c
     JOIN company_alias ca ON ca.company_id = c.id
     WHERE ca.alias_name ILIKE $1
     LIMIT 1`,
    [name] as DuckDBValue[],
  );
  const ilikeRows = ilikeReader.getRowObjectsJS();
  if (ilikeRows.length > 0) return rowToCompany(ilikeRows[0]!);

  // Tier 3: prefix alias match — address_attention starts with a prefix alias
  const prefixReader = await conn.runAndReadAll(
    `SELECT c.* FROM company c
     JOIN company_alias ca ON ca.company_id = c.id
     WHERE ca.alias_type = 'prefix'
       AND $1 ILIKE (ca.alias_name || '%')
     LIMIT 1`,
    [name] as DuckDBValue[],
  );
  const prefixRows = prefixReader.getRowObjectsJS();
  if (prefixRows.length > 0) return rowToCompany(prefixRows[0]!);

  return null;
}

// ── Search ──────────────────────────────────────────────────────────

export async function searchCompanies(
  conn: DuckDBConnection,
  query: string,
  limit: number = 20,
): Promise<CompanyListItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT c.id, c.name, p.name AS parent_name,
            (SELECT count(*) FROM filing f WHERE f.company_id = c.id)::INTEGER AS filing_count
     FROM company c
     LEFT JOIN company p ON p.id = c.parent_company_id
     WHERE c.name ILIKE $1
        OR c.id IN (SELECT company_id FROM company_alias WHERE alias_name ILIKE $1)
     ORDER BY c.name
     LIMIT $2`,
    [`%${query}%`, limit] as DuckDBValue[],
  );

  return reader.getRowObjectsJS().map(rowToCompanyListItem);
}

// ── Attribution stats ───────────────────────────────────────────────

export async function getAttributionStats(
  conn: DuckDBConnection,
): Promise<AttributionStats> {
  const totalReader = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS total FROM filing`,
  );
  const totalFilings: number = Number(
    totalReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  const attrReader = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS attributed FROM filing WHERE company_id IS NOT NULL`,
  );
  const attributedFilings: number = Number(
    attrReader.getRowObjectsJS()[0]?.attributed ?? 0,
  );

  const unattributedFilings: number = totalFilings - attributedFilings;
  const coveragePercent: number =
    totalFilings > 0
      ? Math.round((attributedFilings / totalFilings) * 10000) / 100
      : 0;

  const topReader = await conn.runAndReadAll(
    `SELECT address_attention AS name, count(*)::INTEGER AS count
     FROM filing
     WHERE company_id IS NULL AND address_attention IS NOT NULL AND address_attention != ''
     GROUP BY address_attention
     ORDER BY count DESC
     LIMIT 25`,
  );
  const topUnattributedNames: Array<{ name: string; count: number }> = topReader
    .getRowObjectsJS()
    .map((r) => ({
      name: String(r.name),
      count: Number(r.count),
    }));

  return {
    totalFilings,
    attributedFilings,
    unattributedFilings,
    coveragePercent,
    topUnattributedNames,
  };
}

// ── Company filings (with subsidiary rollup) ────────────────────────

export async function getCompanyFilings(
  conn: DuckDBConnection,
  companyId: number,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<Record<string, unknown>>> {
  const baseSql: string = `
    SELECT f.file_number, f.subsystem_code, f.app_type_code, f.status_code,
           f.address_attention, f.date_filed, f.callsign, f.brief_description
    FROM filing f
    WHERE f.company_id = $1
       OR f.company_id IN (SELECT id FROM company WHERE parent_company_id = $1)`;

  const { sql, params, countSql, countParams } = buildPaginatedQuery(
    baseSql,
    [companyId] as DuckDBValue[],
    pagination,
    FILING_SORTABLE_COLUMNS,
    'date_filed',
  );

  const dataReader = await conn.runAndReadAll(sql, params);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data = dataReader.getRowObjectsJS().map((r) => ({
    fileNumber: String(r.file_number),
    subsystemCode: String(r.subsystem_code ?? ''),
    appTypeCode: String(r.app_type_code ?? ''),
    statusCode: r.status_code != null ? String(r.status_code) : null,
    applicantName:
      r.address_attention != null ? String(r.address_attention) : null,
    dateFiled: r.date_filed != null ? String(r.date_filed) : null,
    callsign: r.callsign != null ? String(r.callsign) : null,
    briefDescription:
      r.brief_description != null ? String(r.brief_description) : null,
  }));
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

// ── Ownership events ────────────────────────────────────────────────

export async function createOwnershipEvent(
  conn: DuckDBConnection,
  data: {
    filingFileNumber: string;
    transferorCompanyId: number | null;
    transfereeCompanyId: number | null;
    effectiveDate: string | null;
    eventType: OwnershipEventType;
    status: OwnershipEventStatus;
    description: string | null;
  },
): Promise<OwnershipEvent> {
  await conn.run(
    `INSERT INTO ownership_event
       (filing_file_number, transferor_company_id, transferee_company_id, effective_date, event_type, status, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.filingFileNumber,
      data.transferorCompanyId,
      data.transfereeCompanyId,
      data.effectiveDate,
      data.eventType,
      data.status,
      data.description,
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM ownership_event WHERE event_id = (SELECT max(event_id) FROM ownership_event)`,
  );
  return rowToOwnershipEvent(reader.getRowObjectsJS()[0]!);
}

export async function getOwnershipEventsForCompany(
  conn: DuckDBConnection,
  companyId: number,
): Promise<OwnershipEvent[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM ownership_event
     WHERE transferor_company_id = $1 OR transferee_company_id = $1
     ORDER BY effective_date DESC NULLS LAST`,
    [companyId] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToOwnershipEvent);
}

// ── Ownership event extraction from T/C and ASG filings ─────────────

export async function extractOwnershipEvents(
  conn: DuckDBConnection,
): Promise<{ created: number; skipped: number }> {
  // Find T/C and ASG filings that don't already have ownership events
  const reader = await conn.runAndReadAll(
    `SELECT f.file_number, f.app_type_code, f.transferor_name, f.transferee_name,
            f.date_filed, f.status_code, f.brief_description
     FROM filing f
     WHERE f.app_type_code IN ('T/C', 'ASG')
       AND (f.transferor_name IS NOT NULL OR f.transferee_name IS NOT NULL)
       AND f.file_number NOT IN (SELECT filing_file_number FROM ownership_event)`,
  );

  let created: number = 0;
  let skipped: number = 0;

  for (const row of reader.getRowObjectsJS()) {
    const fileNumber: string = String(row.file_number);
    const appType: string = String(row.app_type_code);
    const transferorName: string | null =
      row.transferor_name != null ? String(row.transferor_name) : null;
    const transfereeName: string | null =
      row.transferee_name != null ? String(row.transferee_name) : null;

    // Look up companies by alias
    const transferorCompany: Company | null =
      transferorName != null
        ? await getCompanyByAlias(conn, transferorName)
        : null;
    const transfereeCompany: Company | null =
      transfereeName != null
        ? await getCompanyByAlias(conn, transfereeName)
        : null;

    // Only create event if at least one party is identified
    if (transferorCompany == null && transfereeCompany == null) {
      skipped++;
      continue;
    }

    const eventType: OwnershipEventType =
      appType === 'T/C' ? 'transfer_of_control' : 'assignment';

    const statusCode: string | null =
      row.status_code != null ? String(row.status_code) : null;
    let status: OwnershipEventStatus = 'unknown';
    if (statusCode === 'G') status = 'granted';
    else if (statusCode === 'D') status = 'denied';
    else if (statusCode === 'P' || statusCode === 'A') status = 'pending';
    else if (statusCode === 'X') status = 'dismissed';

    // Normalize date to YYYY-MM-DD format for DuckDB DATE column
    let effectiveDate: string | null = null;
    if (row.date_filed != null) {
      const raw: string = String(row.date_filed);
      const parsed: Date = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        effectiveDate = parsed.toISOString().slice(0, 10);
      }
    }

    await createOwnershipEvent(conn, {
      filingFileNumber: fileNumber,
      transferorCompanyId: transferorCompany?.id ?? null,
      transfereeCompanyId: transfereeCompany?.id ?? null,
      effectiveDate,
      eventType,
      status,
      description:
        row.brief_description != null ? String(row.brief_description) : null,
    });
    created++;
  }

  return { created, skipped };
}
