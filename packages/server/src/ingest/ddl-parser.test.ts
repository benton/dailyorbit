import { describe, expect, it } from 'vitest';
import { parseDdl } from './ddl-parser.ts';
import type { TableDef } from './types.ts';

const SMALL_DDL = `
/* ============================================================ */
/*   Table: STATUS_CODE                                         */
/* ============================================================ */
create table STATUS_CODE
(
    status_code                   char(5)                not null,
    description                   varchar(40)            null    ,
    active_sw                     char(1)                null    ,
    active_date                   datetime               null
)
go

/* ============================================================ */
/*   Index: STATUS_CODE_PK                                      */
/* ============================================================ */
create unique index STATUS_CODE_PK on STATUS_CODE (status_code)
go
`;

const MULTI_TABLE_DDL = `
create table POLARIZATION_CODE
(
    polarization_code             char(2)                not null,
    description                   varchar(40)            null
)
go

create unique index POLARIZATION_CODE_PK on POLARIZATION_CODE (polarization_code)
go

create table SPACE_STATION
(
    space_station_key             int                    not null,
    us_call_sign                  char(10)               null    ,
    itu_call_sign                 char(10)               null    ,
    orbit_location                float                  null    ,
    orbit_hemi                    char(1)                null
)
go

create unique index SPACE_STATION_PK on SPACE_STATION (space_station_key)
go
`;

const COMPOSITE_PK_DDL = `
create table STATUS_TRACKING
(
    filing_key                    int                    not null,
    status_code                   char(5)                not null,
    status_date                   datetime               not null,
    user_id                       char(8)                null
)
go

create unique index STATUS_TRACKING_PK on STATUS_TRACKING (filing_key, status_code, status_date)
go
`;

const MAIN_TABLE_DDL = `
create table MAIN
(
    filing_key                    int                    not null,
    filing_state                  tinyint                default 0 null    ,
    callsign                      char(10)               null    ,
    file_number                   char(19)               not null
)
go

create unique index MAIN_PK on MAIN (filing_key)
go
`;

describe('parseDdl', () => {
  it('parses a single table with columns and primary key', () => {
    const tables: TableDef[] = parseDdl(SMALL_DDL);

    expect(tables).toHaveLength(1);
    const table: TableDef = tables[0]!;
    expect(table.ddlName).toBe('STATUS_CODE');
    expect(table.appName).toBe('status_code');
    expect(table.primaryKey).toEqual(['status_code']);
    expect(table.columns).toEqual([
      {
        name: 'status_code',
        sybaseType: 'char(5)',
        duckdbType: 'VARCHAR',
        nullable: false,
      },
      {
        name: 'description',
        sybaseType: 'varchar(40)',
        duckdbType: 'VARCHAR',
        nullable: true,
      },
      {
        name: 'active_sw',
        sybaseType: 'char(1)',
        duckdbType: 'VARCHAR',
        nullable: true,
      },
      {
        name: 'active_date',
        sybaseType: 'datetime',
        duckdbType: 'TIMESTAMP',
        nullable: true,
      },
    ]);
  });

  it('parses multiple tables from a single DDL string', () => {
    const tables: TableDef[] = parseDdl(MULTI_TABLE_DDL);

    expect(tables).toHaveLength(2);
    expect(tables[0]!.ddlName).toBe('POLARIZATION_CODE');
    expect(tables[0]!.columns).toHaveLength(2);
    expect(tables[1]!.ddlName).toBe('SPACE_STATION');
    expect(tables[1]!.columns).toHaveLength(5);
  });

  it('maps Sybase types to DuckDB types correctly', () => {
    const tables: TableDef[] = parseDdl(MULTI_TABLE_DDL);
    const spaceStation: TableDef = tables[1]!;

    expect(spaceStation.columns.map((c) => [c.name, c.duckdbType])).toEqual([
      ['space_station_key', 'INTEGER'],
      ['us_call_sign', 'VARCHAR'],
      ['itu_call_sign', 'VARCHAR'],
      ['orbit_location', 'DOUBLE'],
      ['orbit_hemi', 'VARCHAR'],
    ]);
  });

  it('parses composite primary keys', () => {
    const tables: TableDef[] = parseDdl(COMPOSITE_PK_DDL);

    expect(tables[0]!.primaryKey).toEqual([
      'filing_key',
      'status_code',
      'status_date',
    ]);
  });

  it('handles columns with default values in the DDL', () => {
    const tables: TableDef[] = parseDdl(MAIN_TABLE_DDL);
    const filingState = tables[0]!.columns[1]!;

    expect(filingState.name).toBe('filing_state');
    expect(filingState.sybaseType).toBe('tinyint');
    expect(filingState.duckdbType).toBe('TINYINT');
    expect(filingState.nullable).toBe(true);
  });

  it('renames MAIN table to filing in appName', () => {
    const tables: TableDef[] = parseDdl(MAIN_TABLE_DDL);

    expect(tables[0]!.ddlName).toBe('MAIN');
    expect(tables[0]!.appName).toBe('filing');
  });

  it('returns empty array for empty input', () => {
    expect(parseDdl('')).toEqual([]);
    expect(parseDdl('/* just comments */')).toEqual([]);
  });

  it('derives datFile from ddlName', () => {
    const tables: TableDef[] = parseDdl(SMALL_DDL);
    expect(tables[0]!.datFile).toBe('status_code.dat');
  });
});
