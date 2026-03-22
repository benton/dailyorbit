import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewsTables } from './schema.ts';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';
import {
  createNewsSource,
  deleteNewsSource,
  findExistingNewsItemSummaryByChecksum,
  getNewsItemById,
  getNewsItemsNeedingAttribution,
  getNewsItemsNeedingExtraction,
  getNewsItemsNeedingSummary,
  getNewsSourceById,
  getSourcesDueForFetch,
  listNewsItems,
  listNewsSources,
  markExtractionFailed,
  saveNewsItemSummary,
  seedNewsSources,
  setNewsItemCompany,
  updateNewsItemExtraction,
  updateNewsSource,
  updateSourceFetchStatus,
  upsertNewsItem,
} from './repository.ts';
import type { NewsSourceSeedEntry } from './types.ts';

describe('news repository', () => {
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
    await ensureHiddenItemTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  // ── News Source CRUD ──────────────────────────────────────────────

  describe('createNewsSource / getNewsSourceById', () => {
    it('creates a source and retrieves it by id', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
        category: 'industry',
      });

      expect(source.name).toEqual('SpaceNews');
      expect(source.feedUrl).toEqual('https://spacenews.com/feed/');
      expect(source.category).toEqual('industry');
      expect(source.enabled).toEqual(true);
      expect(source.id).toBeGreaterThan(0);

      const fetched = await getNewsSourceById(conn, source.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toEqual('SpaceNews');
    });

    it('returns null for non-existent id', async () => {
      const fetched = await getNewsSourceById(conn, 99999);
      expect(fetched).toBeNull();
    });
  });

  describe('listNewsSources', () => {
    it('returns all sources ordered by name', async () => {
      await createNewsSource(conn, {
        name: 'Zeta News',
        feedUrl: 'https://zeta.example/feed',
      });
      await createNewsSource(conn, {
        name: 'Alpha News',
        feedUrl: 'https://alpha.example/feed',
      });

      const sources = await listNewsSources(conn);
      expect(sources.length).toEqual(2);
      expect(sources[0]!.name).toEqual('Alpha News');
      expect(sources[1]!.name).toEqual('Zeta News');
    });
  });

  describe('updateNewsSource', () => {
    it('updates specified fields without touching others', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
        category: 'industry',
      });

      const updated = await updateNewsSource(conn, source.id, {
        enabled: false,
        fetchIntervalMinutes: 120,
      });

      expect(updated!.enabled).toEqual(false);
      expect(updated!.fetchIntervalMinutes).toEqual(120);
      expect(updated!.name).toEqual('SpaceNews');
    });

    it('returns null for non-existent source', async () => {
      const result = await updateNewsSource(conn, 99999, { name: 'Ghost' });
      expect(result).toBeNull();
    });
  });

  describe('deleteNewsSource', () => {
    it('deletes source and its news items', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Article 1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const deleted = await deleteNewsSource(conn, source.id);
      expect(deleted).toEqual(true);

      const fetched = await getNewsSourceById(conn, source.id);
      expect(fetched).toBeNull();

      const items = await listNewsItems(conn, {});
      expect(items.totalRows).toEqual(0);
    });

    it('returns false for non-existent source', async () => {
      const deleted = await deleteNewsSource(conn, 99999);
      expect(deleted).toEqual(false);
    });
  });

  describe('updateSourceFetchStatus', () => {
    it('records fetch success with timestamp', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });

      await updateSourceFetchStatus(conn, source.id, 'success', null);
      const updated = await getNewsSourceById(conn, source.id);

      expect(updated!.lastFetchStatus).toEqual('success');
      expect(updated!.lastFetchedAt).not.toBeNull();
      expect(updated!.lastFetchError).toBeNull();
    });

    it('records fetch failure with error message', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });

      await updateSourceFetchStatus(conn, source.id, 'failed', 'HTTP 503');
      const updated = await getNewsSourceById(conn, source.id);

      expect(updated!.lastFetchStatus).toEqual('failed');
      expect(updated!.lastFetchError).toEqual('HTTP 503');
    });
  });

  // ── Seeding ───────────────────────────────────────────────────────

  describe('seedNewsSources', () => {
    const seeds: ReadonlyArray<NewsSourceSeedEntry> = [
      {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
        category: 'industry',
        enabled: true,
      },
      {
        name: 'Via Satellite',
        feedUrl: 'https://www.satellitetoday.com/feed/',
        category: 'industry',
        enabled: true,
      },
    ];

    it('creates new sources from seed data', async () => {
      const result = await seedNewsSources(conn, seeds);
      expect(result.created).toEqual(2);
      expect(result.skipped).toEqual(0);

      const sources = await listNewsSources(conn);
      expect(sources.length).toEqual(2);
    });

    it('is idempotent — skips existing feed URLs', async () => {
      await seedNewsSources(conn, seeds);
      const result = await seedNewsSources(conn, seeds);
      expect(result.created).toEqual(0);
      expect(result.skipped).toEqual(2);
    });
  });

  // ── Pipeline helpers ──────────────────────────────────────────────

  describe('getSourcesDueForFetch', () => {
    it('returns enabled sources that have never been fetched', async () => {
      await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
        enabled: true,
      });
      await createNewsSource(conn, {
        name: 'Disabled',
        feedUrl: 'https://disabled.example/feed',
        enabled: false,
      });

      const due = await getSourcesDueForFetch(conn);
      expect(due.length).toEqual(1);
      expect(due[0]!.name).toEqual('SpaceNews');
    });
  });

  // ── News Item CRUD ────────────────────────────────────────────────

  describe('upsertNewsItem / getNewsItemById', () => {
    it('inserts a new item and retrieves it', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });

      const inserted = await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'SpaceX launches Starlink',
        author: 'Jeff Foust',
        publishedAt: '2026-03-15T12:00:00Z',
        tags: ['spacex', 'starlink'],
      });
      expect(inserted).toEqual(true);

      // Use listNewsItems to find it since we don't return the ID from upsert
      const items = await listNewsItems(conn, { page: 1, pageSize: 10 });
      expect(items.totalRows).toEqual(1);
      expect(items.data[0]!.title).toEqual('SpaceX launches Starlink');
      expect(items.data[0]!.author).toEqual('Jeff Foust');
      expect(items.data[0]!.extractStatus).toEqual('pending');
    });

    it('returns false for duplicate source_url (dedup)', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });

      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'First insert',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const second = await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Duplicate',
        author: null,
        publishedAt: null,
        tags: [],
      });
      expect(second).toEqual(false);

      const items = await listNewsItems(conn, {});
      expect(items.totalRows).toEqual(1);
      expect(items.data[0]!.title).toEqual('First insert');
    });
  });

  describe('listNewsItems with filters', () => {
    it('filters by news source id', async () => {
      const s1 = await createNewsSource(conn, {
        name: 'Source A',
        feedUrl: 'https://a.example/feed',
      });
      const s2 = await createNewsSource(conn, {
        name: 'Source B',
        feedUrl: 'https://b.example/feed',
      });

      await upsertNewsItem(conn, {
        newsSourceId: s1.id,
        sourceUrl: 'https://a.example/1',
        title: 'A1',
        author: null,
        publishedAt: null,
        tags: [],
      });
      await upsertNewsItem(conn, {
        newsSourceId: s2.id,
        sourceUrl: 'https://b.example/1',
        title: 'B1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const result = await listNewsItems(conn, {}, { newsSourceId: s1.id });
      expect(result.totalRows).toEqual(1);
      expect(result.data[0]!.title).toEqual('A1');
    });
  });

  // ── Extraction pipeline ───────────────────────────────────────────

  describe('getNewsItemsNeedingExtraction / updateNewsItemExtraction', () => {
    it('returns pending items and updates extraction data', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Article 1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const pending = await getNewsItemsNeedingExtraction(conn);
      expect(pending.length).toEqual(1);

      const item = pending[0]!;
      await updateNewsItemExtraction(conn, item.id, {
        fullText: 'Article content here',
        textLength: 20,
        textChecksum: 'abc123',
        extractStatus: 'extracted',
      });

      const updated = await getNewsItemById(conn, item.id);
      expect(updated!.fullText).toEqual('Article content here');
      expect(updated!.textLength).toEqual(20);
      expect(updated!.textChecksum).toEqual('abc123');
      expect(updated!.extractStatus).toEqual('extracted');
    });

    it('markExtractionFailed sets status to failed', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Article 1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const pending = await getNewsItemsNeedingExtraction(conn);
      await markExtractionFailed(conn, pending[0]!.id);

      const updated = await getNewsItemById(conn, pending[0]!.id);
      expect(updated!.extractStatus).toEqual('failed');

      // Should no longer appear in pending
      const stillPending = await getNewsItemsNeedingExtraction(conn);
      expect(stillPending.length).toEqual(0);
    });
  });

  // ── Summarization pipeline ────────────────────────────────────────

  describe('getNewsItemsNeedingSummary / saveNewsItemSummary', () => {
    it('returns items with text but no summary, then saves summary', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Article 1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const pending = await getNewsItemsNeedingExtraction(conn);
      await updateNewsItemExtraction(conn, pending[0]!.id, {
        fullText: 'Some article text',
        textLength: 17,
        textChecksum: 'checksum1',
        extractStatus: 'extracted',
      });

      const needingSummary = await getNewsItemsNeedingSummary(conn);
      expect(needingSummary.length).toEqual(1);

      await saveNewsItemSummary(
        conn,
        needingSummary[0]!.id,
        'Summary of article',
        'nova-pro',
      );

      const updated = await getNewsItemById(conn, needingSummary[0]!.id);
      expect(updated!.summary).toEqual('Summary of article');
      expect(updated!.summarizedBy).toEqual('nova-pro');
      expect(updated!.summarizedAt).not.toBeNull();

      // Should no longer need summary
      const stillNeeding = await getNewsItemsNeedingSummary(conn);
      expect(stillNeeding.length).toEqual(0);
    });
  });

  describe('findExistingNewsItemSummaryByChecksum', () => {
    it('finds an existing summary by text checksum', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'Article 1',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const items = await getNewsItemsNeedingExtraction(conn);
      await updateNewsItemExtraction(conn, items[0]!.id, {
        fullText: 'Some article text',
        textLength: 17,
        textChecksum: 'shared-checksum',
        extractStatus: 'extracted',
      });
      await saveNewsItemSummary(conn, items[0]!.id, 'Shared summary', 'model');

      const found = await findExistingNewsItemSummaryByChecksum(
        conn,
        'shared-checksum',
      );
      expect(found).toEqual('Shared summary');
    });

    it('returns null when no match', async () => {
      const found = await findExistingNewsItemSummaryByChecksum(
        conn,
        'nonexistent',
      );
      expect(found).toBeNull();
    });
  });

  // ── Company attribution ───────────────────────────────────────────

  describe('getNewsItemsNeedingAttribution / setNewsItemCompany', () => {
    it('returns items without company and sets company', async () => {
      const source = await createNewsSource(conn, {
        name: 'SpaceNews',
        feedUrl: 'https://spacenews.com/feed/',
      });
      await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl: 'https://spacenews.com/article-1',
        title: 'SpaceX launches',
        author: null,
        publishedAt: null,
        tags: [],
      });

      const items = await getNewsItemsNeedingExtraction(conn);
      await updateNewsItemExtraction(conn, items[0]!.id, {
        fullText: 'SpaceX launched a Starlink mission today.',
        textLength: 41,
        textChecksum: 'check1',
        extractStatus: 'extracted',
      });

      const needing = await getNewsItemsNeedingAttribution(conn);
      expect(needing.length).toEqual(1);

      await setNewsItemCompany(conn, needing[0]!.id, 42);

      const updated = await getNewsItemById(conn, needing[0]!.id);
      expect(updated!.companyId).toEqual(42);

      // Should no longer need attribution
      const stillNeeding = await getNewsItemsNeedingAttribution(conn);
      expect(stillNeeding.length).toEqual(0);
    });
  });
});
