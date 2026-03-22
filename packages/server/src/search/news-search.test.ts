import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';
import { rebuildAllFtsIndexes } from './fts-index.ts';
import { searchNewsByKeyword, searchNewsByVector } from './news-search.ts';

describe('news-search', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create required tables
    await conn.run(`
      CREATE TABLE company (id INTEGER PRIMARY KEY, name VARCHAR, parent_company_id INTEGER)
    `);
    await conn.run(`
      CREATE TABLE news_source (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        feed_url VARCHAR NOT NULL UNIQUE,
        category VARCHAR NOT NULL DEFAULT 'industry',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_fetched_at TIMESTAMP,
        last_fetch_status VARCHAR,
        last_fetch_error VARCHAR,
        created_at TIMESTAMP DEFAULT current_timestamp,
        updated_at TIMESTAMP DEFAULT current_timestamp
      )
    `);
    await conn.run(`
      CREATE TABLE news_item (
        id INTEGER PRIMARY KEY,
        news_source_id INTEGER NOT NULL,
        source_url VARCHAR NOT NULL UNIQUE,
        title VARCHAR NOT NULL,
        author VARCHAR,
        published_at TIMESTAMP,
        fetched_at TIMESTAMP DEFAULT current_timestamp,
        full_text VARCHAR,
        text_length INTEGER,
        text_checksum VARCHAR,
        summary VARCHAR,
        summarized_by VARCHAR,
        summarized_at TIMESTAMP,
        extract_status VARCHAR NOT NULL DEFAULT 'pending',
        company_id INTEGER,
        tags VARCHAR[],
        indexed_by VARCHAR,
        indexed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT current_timestamp
      )
    `);

    // Seed test data
    await conn.run(`
      INSERT INTO company VALUES (1, 'SpaceX', NULL)
    `);
    await conn.run(`
      INSERT INTO news_source VALUES
        (1, 'SpaceNews', 'https://spacenews.com/feed/', 'industry', TRUE, 60, NULL, NULL, NULL, current_timestamp, current_timestamp),
        (2, 'Via Satellite', 'https://viasatellite.com/feed/', 'industry', TRUE, 60, NULL, NULL, NULL, current_timestamp, current_timestamp)
    `);
    await conn.run(`
      INSERT INTO news_item (id, news_source_id, source_url, title, full_text, summary, published_at, extract_status, company_id) VALUES
        (1, 1, 'https://spacenews.com/starlink-expansion',
         'SpaceX launches new Starlink satellites for broadband expansion',
         'SpaceX successfully launched 23 Starlink satellites from Cape Canaveral on Monday, expanding its broadband constellation to over 6,000 operational units. The Falcon 9 first stage landed on a drone ship in the Atlantic.',
         'SpaceX launched 23 Starlink satellites, expanding the constellation past 6,000 units.',
         '2024-06-15', 'extracted', 1),
        (2, 1, 'https://spacenews.com/fcc-spectrum-ruling',
         'FCC issues new spectrum allocation ruling for Ka-band satellite operators',
         'The Federal Communications Commission issued a landmark ruling on Ka-band spectrum allocation that could reshape the competitive landscape for satellite broadband providers. The ruling establishes new sharing frameworks between NGSO and GSO operators.',
         'FCC Ka-band ruling establishes new sharing frameworks for satellite operators.',
         '2024-07-01', 'extracted', NULL),
        (3, 2, 'https://viasatellite.com/ses-o3b-mpower',
         'SES O3b mPOWER constellation reaches full operational capability',
         'SES announced that its O3b mPOWER medium earth orbit constellation has achieved full operational capability with all satellites in service. The system delivers terabits of throughput for enterprise and government customers.',
         'SES O3b mPOWER MEO constellation fully operational.',
         '2024-08-10', 'extracted', NULL),
        (4, 2, 'https://viasatellite.com/weather-forecast',
         'Sunny skies expected for launch window',
         'Weather conditions look favorable for the upcoming rocket launch window this weekend.',
         'Good weather expected for launch.',
         '2024-09-01', 'extracted', NULL)
    `);

    await rebuildAllFtsIndexes(conn);
    await ensureHiddenItemTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('searchNewsByKeyword', () => {
    it('returns matching news items ranked by BM25 score', async () => {
      const hits = await searchNewsByKeyword(
        conn,
        'Ka-band spectrum satellite',
        10,
      );

      expect(hits.length).toBeGreaterThan(0);
      // The FCC Ka-band article should rank highest
      expect(hits[0]!.title).toContain('Ka-band');
      expect(hits[0]!.source_name).toEqual('SpaceNews');
      expect(hits[0]!.score).toBeGreaterThan(0);
    });

    it('returns empty array for non-matching query', async () => {
      const hits = await searchNewsByKeyword(conn, 'xyznonexistent42', 10);

      expect(hits).toEqual([]);
    });

    it('returns empty array for empty query', async () => {
      const hits = await searchNewsByKeyword(conn, '  ', 10);

      expect(hits).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      const hits = await searchNewsByKeyword(conn, 'satellite', 2);

      expect(hits.length).toBeLessThanOrEqual(2);
    });

    it('includes company_name when news item is attributed', async () => {
      const hits = await searchNewsByKeyword(conn, 'Starlink broadband', 10);

      expect(hits.length).toBeGreaterThan(0);
      const starlink = hits.find((h) => h.title.includes('Starlink'));
      expect(starlink).toBeDefined();
      expect(starlink!.company_name).toEqual('SpaceX');
    });

    it('returns null company_name for unattributed news', async () => {
      const hits = await searchNewsByKeyword(conn, 'Ka-band spectrum', 10);

      const kaBand = hits.find((h) => h.title.includes('Ka-band'));
      expect(kaBand).toBeDefined();
      expect(kaBand!.company_name).toBeNull();
    });

    it('generates snippets with highlight marks', async () => {
      const hits = await searchNewsByKeyword(conn, 'Starlink', 10);

      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.snippet).toContain('<mark>');
    });

    it('populates all fields on returned hits', async () => {
      const hits = await searchNewsByKeyword(conn, 'satellite', 10);

      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.news_item_id).toBeGreaterThan(0);
        expect(hit.title.length).toBeGreaterThan(0);
        expect(hit.source_name.length).toBeGreaterThan(0);
        expect(hit.source_url.length).toBeGreaterThan(0);
        expect(typeof hit.score).toEqual('number');
      }
    });
  });

  describe('searchNewsByVector', () => {
    beforeEach(async () => {
      // Create embedding table and seed with test vectors
      await conn.run(`INSTALL vss; LOAD vss;`);
      await conn.run(`SET hnsw_enable_experimental_persistence = true`);
      await conn.run(`
        CREATE TABLE embedding (
          embedding_id INTEGER PRIMARY KEY,
          source_table VARCHAR NOT NULL,
          source_key VARCHAR NOT NULL,
          chunk_index INTEGER NOT NULL DEFAULT 0,
          embedding FLOAT[512],
          model_id VARCHAR,
          text_checksum VARCHAR,
          created_at TIMESTAMP DEFAULT current_timestamp,
          UNIQUE (source_table, source_key, chunk_index)
        )
      `);

      // Generate deterministic pseudo-embeddings for testing.
      // news_item 1 (Starlink) and 2 (Ka-band) get similar vectors;
      // news_item 3 (SES) gets a different vector.
      const starlink = generateTestEmbedding(1);
      const kaBand = generateTestEmbedding(2);
      const ses = generateTestEmbedding(100); // very different

      await conn.run(`
        INSERT INTO embedding (embedding_id, source_table, source_key, chunk_index, embedding, model_id) VALUES
          (1, 'news_item', '1', 0, '${formatEmbedding(starlink)}'::FLOAT[512], 'test-model'),
          (2, 'news_item', '2', 0, '${formatEmbedding(kaBand)}'::FLOAT[512], 'test-model'),
          (3, 'news_item', '3', 0, '${formatEmbedding(ses)}'::FLOAT[512], 'test-model')
      `);
    });

    it('returns news items ranked by vector similarity', async () => {
      const queryEmbedding: number[] = generateTestEmbedding(1); // similar to Starlink

      const hits = await searchNewsByVector(conn, queryEmbedding, 10);

      expect(hits.length).toEqual(3);
      // Starlink should be the closest match (identical embedding)
      expect(hits[0]!.news_item_id).toEqual(1);
      expect(hits[0]!.score).toBeGreaterThan(hits[2]!.score);
    });

    it('respects the limit parameter', async () => {
      const queryEmbedding: number[] = generateTestEmbedding(1);

      const hits = await searchNewsByVector(conn, queryEmbedding, 1);

      expect(hits.length).toEqual(1);
    });

    it('returns snippet from news content', async () => {
      const queryEmbedding: number[] = generateTestEmbedding(1);

      const hits = await searchNewsByVector(conn, queryEmbedding, 10);

      expect(hits[0]!.snippet.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Generate a deterministic 512-d test embedding seeded by a number.
 * Nearby seeds produce similar vectors via simple sin/cos pattern.
 */
function generateTestEmbedding(seed: number): number[] {
  const embedding: number[] = Array.from({ length: 512 });
  for (let i: number = 0; i < 512; i++) {
    embedding[i] = Math.sin(seed * 0.1 + i * 0.01) * 0.5 + 0.5;
  }
  // Normalize to unit length
  const norm: number = Math.sqrt(
    embedding.reduce((sum: number, v: number) => sum + v * v, 0),
  );
  for (let i: number = 0; i < 512; i++) {
    embedding[i] = embedding[i]! / norm;
  }
  return embedding;
}

function formatEmbedding(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
