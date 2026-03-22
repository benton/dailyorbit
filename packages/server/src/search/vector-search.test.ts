import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';
import { searchByVector } from './vector-search.ts';

describe('searchByVector', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let vssAvailable: boolean = false;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Try to load VSS extension — skip tests if not available
    try {
      await conn.run(`INSTALL vss; LOAD vss;`);
      vssAvailable = true;
    } catch {
      vssAvailable = false;
      return;
    }

    // Create minimal schema needed for vector search
    await conn.run(`
      CREATE TABLE filing (
        file_number VARCHAR PRIMARY KEY,
        filing_key INTEGER,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        date_filed DATE,
        company_id INTEGER,
        description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE pleading (
        pleading_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        exhibit_attachment_html VARCHAR
      )
    `);
    await conn.run(
      `CREATE TABLE company (id INTEGER PRIMARY KEY, name VARCHAR, parent_company_id INTEGER)`,
    );

    // Create embedding table (no HNSW index needed for small test data)
    await conn.run(`CREATE SEQUENCE IF NOT EXISTS embedding_id_seq`);
    await conn.run(`
      CREATE TABLE embedding (
        embedding_id  INTEGER PRIMARY KEY DEFAULT nextval('embedding_id_seq'),
        source_table  VARCHAR NOT NULL,
        source_key    VARCHAR NOT NULL,
        chunk_index   INTEGER NOT NULL DEFAULT 0,
        embedding     FLOAT[512],
        model_id      VARCHAR NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (source_table, source_key, chunk_index)
      )
    `);

    // Insert test filings
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Ka-band satellite frequency allocation request'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SES-LIC-20240201-00002', 2, 'E001', 'Hughes Net', 'SES', 'LIC', 'P', '2024-02-01', NULL,
      'Earth station license application'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-MOD-20240301-00003', 3, 'SATX2', 'Viasat Inc', 'SAT', 'MOD', 'A', '2024-03-01', NULL,
      'Modification for C-band operations'
    )`);

    // Insert embeddings with known vectors:
    // - Filing 1: vector pointing "up" (high cosine similarity to query)
    // - Filing 2: vector pointing "sideways" (medium similarity)
    // - Filing 3: vector pointing "down" (low similarity)
    const upVector: string = JSON.stringify(
      Array.from({ length: 512 }, (_, i: number) => (i === 0 ? 1.0 : 0.0)),
    );
    const sideVector: string = JSON.stringify(
      Array.from({ length: 512 }, (_, i: number) => (i === 1 ? 1.0 : 0.0)),
    );
    const downVector: string = JSON.stringify(
      Array.from({ length: 512 }, (_, i: number) => (i === 0 ? -1.0 : 0.0)),
    );

    await conn.run(
      `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id)
       VALUES ('filing', 'SAT-LOA-20240101-00001', 0, '${upVector}'::FLOAT[512], 'test-model')`,
    );
    await conn.run(
      `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id)
       VALUES ('filing', 'SES-LIC-20240201-00002', 0, '${sideVector}'::FLOAT[512], 'test-model')`,
    );
    await conn.run(
      `INSERT INTO embedding (source_table, source_key, chunk_index, embedding, model_id)
       VALUES ('filing', 'SAT-MOD-20240301-00003', 0, '${downVector}'::FLOAT[512], 'test-model')`,
    );

    await ensureHiddenItemTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('ranks results by cosine similarity to the query vector', async () => {
    if (!vssAvailable) return;

    // Query vector pointing "up" — should match filing 1 best
    const queryEmbedding: number[] = Array.from(
      { length: 512 },
      (_, i: number) => (i === 0 ? 1.0 : 0.0),
    );

    const { hits } = await searchByVector(
      conn,
      queryEmbedding,
      {},
      'satellite',
      10,
      0,
    );

    expect(hits.length).toEqual(3);
    // Filing 1 (up vector) should be most similar
    expect(hits[0]!.file_number).toEqual('SAT-LOA-20240101-00001');
    expect(hits[0]!.score).toBeCloseTo(1.0, 5);
    // Filing 3 (down vector) should be least similar
    expect(hits[2]!.file_number).toEqual('SAT-MOD-20240301-00003');
    expect(hits[2]!.score).toBeCloseTo(-1.0, 5);
  });

  it('applies metadata filters', async () => {
    if (!vssAvailable) return;

    const queryEmbedding: number[] = Array.from(
      { length: 512 },
      (_, i: number) => (i === 0 ? 1.0 : 0.0),
    );

    const { hits } = await searchByVector(
      conn,
      queryEmbedding,
      { subsystem_code: ['SAT'] },
      'satellite',
      10,
      0,
    );

    // Only SAT filings should be returned (1 and 3, not 2 which is SES)
    const fileNumbers: string[] = hits.map((h) => h.file_number);
    expect(fileNumbers).toContain('SAT-LOA-20240101-00001');
    expect(fileNumbers).toContain('SAT-MOD-20240301-00003');
    expect(fileNumbers).not.toContain('SES-LIC-20240201-00002');
  });

  it('respects limit and offset', async () => {
    if (!vssAvailable) return;

    const queryEmbedding: number[] = Array.from(
      { length: 512 },
      (_, i: number) => (i === 0 ? 1.0 : 0.0),
    );

    const { hits } = await searchByVector(
      conn,
      queryEmbedding,
      {},
      'satellite',
      1,
      0,
    );

    expect(hits.length).toEqual(1);
    expect(hits[0]!.file_number).toEqual('SAT-LOA-20240101-00001');
  });

  it('returns empty results when no embeddings exist', async () => {
    if (!vssAvailable) return;

    // Clear all embeddings
    await conn.run(`DELETE FROM embedding`);

    const queryEmbedding: number[] = Array.from({ length: 512 }, () => 0.5);
    const { hits, total } = await searchByVector(
      conn,
      queryEmbedding,
      {},
      'test',
      10,
      0,
    );

    expect(hits).toHaveLength(0);
    expect(total).toEqual(0);
  });
});
