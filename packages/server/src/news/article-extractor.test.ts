import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewsTables } from './schema.ts';
import {
  createNewsSource,
  getNewsItemsNeedingExtraction,
  upsertNewsItem,
} from './repository.ts';
import { extractArticles } from './article-extractor.ts';

vi.mock('@extractus/article-extractor', () => ({
  extract: vi.fn(async (url: string) => {
    if (url.includes('success')) {
      return {
        content: '<p>Extracted article content about SpaceX and Starlink.</p>',
      };
    }
    if (url.includes('empty')) {
      return { content: '' };
    }
    if (url.includes('null-content')) {
      return { content: null };
    }
    throw new Error('Network error');
  }),
}));

describe('article-extractor', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewsTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('extractArticles', () => {
    it('extracts text and stores checksum for successful articles', async () => {
      const source = await createNewsSource(conn, {
        name: 'Test',
        feedUrl: 'https://test.example/feed',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://test.example/success-article',
        title: 'Success Article',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const result = await extractArticles(conn, 10, 1);

      expect(result.extracted).toEqual(1);
      expect(result.failed).toEqual(0);

      const pending = await getNewsItemsNeedingExtraction(conn);
      expect(pending.length).toEqual(0);

      // Check the extracted item
      const items = await getNewsItemsNeedingExtraction(conn);
      expect(items.length).toEqual(0); // no more pending

      // Get the item directly to verify fields
      const allItems = await conn.runAndReadAll(
        `SELECT * FROM news_item WHERE source_url LIKE '%success%'`,
      );
      const row = allItems.getRowObjectsJS()[0]!;
      expect(row.extract_status).toEqual('extracted');
      expect(row.full_text).not.toBeNull();
      expect(row.text_checksum).not.toBeNull();
      expect(Number(row.text_length)).toBeGreaterThan(0);
    });

    it('marks items as failed when extraction returns null content', async () => {
      const source = await createNewsSource(conn, {
        name: 'Test',
        feedUrl: 'https://test.example/feed',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://test.example/null-content-article',
        title: 'Null Content',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const result = await extractArticles(conn, 10, 1);
      expect(result.failed).toEqual(1);
      expect(result.extracted).toEqual(0);
    });

    it('marks items as failed when extraction throws', async () => {
      const source = await createNewsSource(conn, {
        name: 'Test',
        feedUrl: 'https://test.example/feed',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://test.example/error-article',
        title: 'Error Article',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const result = await extractArticles(conn, 10, 1);
      expect(result.failed).toEqual(1);

      const items = await getNewsItemsNeedingExtraction(conn);
      expect(items.length).toEqual(0); // marked as failed, not pending
    });

    it('handles mixed success and failure in a batch', async () => {
      const source = await createNewsSource(conn, {
        name: 'Test',
        feedUrl: 'https://test.example/feed',
      });

      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://test.example/success-1',
        title: 'Good Article',
        author: null,
        publishedAt: null,
        tags: [],
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://test.example/error-2',
        title: 'Bad Article',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const result = await extractArticles(conn, 10, 1);
      expect(result.extracted).toEqual(1);
      expect(result.failed).toEqual(1);
    });

    it('returns zero counts when no items need extraction', async () => {
      const result = await extractArticles(conn, 10, 1);
      expect(result).toEqual({ extracted: 0, failed: 0, skipped: 0 });
    });
  });
});
