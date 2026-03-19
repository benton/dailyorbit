import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewsTables } from './schema.ts';
import {
  createNewsSource,
  listNewsItems,
  getNewsSourceById,
} from './repository.ts';
import { fetchSingleSource } from './rss-fetcher.ts';
import type { NewsSource } from './types.ts';

// Mock rss-parser to avoid real HTTP requests in tests
vi.mock('rss-parser', () => {
  class MockRssParser {
    async parseURL(_url: string) {
      return {
        items: [
          {
            title: 'SpaceX launches Starlink batch',
            link: 'https://spacenews.com/spacex-starlink-batch',
            isoDate: '2026-03-15T12:00:00Z',
            creator: 'Jeff Foust',
            categories: ['spacex', 'starlink'],
          },
          {
            title: 'FCC approves new spectrum allocation',
            link: 'https://spacenews.com/fcc-spectrum',
            isoDate: '2026-03-14T10:00:00Z',
            creator: null,
            categories: [],
          },
          {
            // Missing link — should be skipped
            title: 'Untitled with no link',
            link: undefined,
            categories: [],
          },
        ],
      };
    }
  }
  return { default: MockRssParser };
});

describe('rss-fetcher', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Minimal company table needed for LEFT JOIN in news queries
    await conn.run(
      `CREATE TABLE IF NOT EXISTS company (id INTEGER PRIMARY KEY, name VARCHAR, parent_company_id INTEGER)`,
    );
    await ensureNewsTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('fetchSingleSource', () => {
    it('inserts new items from RSS feed and updates source status', async () => {
      const source: NewsSource = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
        category: 'industry',
      });

      const result = await fetchSingleSource(conn, source);

      expect(result.sourceName).toEqual('SpaceNews');
      expect(result.itemsInserted).toEqual(2);
      expect(result.itemsSkipped).toEqual(1); // the one without link
      expect(result.error).toBeNull();

      // Verify items were inserted
      const items = await listNewsItems(conn, { page: 1, pageSize: 10 });
      expect(items.totalRows).toEqual(2);

      // Verify source status was updated
      const updated = await getNewsSourceById(conn, source.id);
      expect(updated!.lastFetchStatus).toEqual('success');
      expect(updated!.lastFetchedAt).not.toBeNull();
    });

    it('is idempotent — duplicate URLs are skipped on second fetch', async () => {
      const source: NewsSource = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });

      await fetchSingleSource(conn, source);
      const result = await fetchSingleSource(conn, source);

      expect(result.itemsInserted).toEqual(0);
      expect(result.itemsSkipped).toEqual(3); // 2 dupes + 1 without link

      const items = await listNewsItems(conn, {});
      expect(items.totalRows).toEqual(2); // still only 2
    });
  });
});
