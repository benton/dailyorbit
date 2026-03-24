import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';
import {
  ensureEdition,
  getArticle,
  getArticlesByEdition,
  getEditionByDate,
  getLatestEdition,
  listEditions,
  resetArticle,
  updateEditionStatus,
  upsertArticle,
} from './repository.ts';

describe('newspaper repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  // ── Edition CRUD ──────────────────────────────────────────────────

  describe('ensureEdition', () => {
    it('creates a new edition and returns it', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');

      expect(edition.editionDate).toContain('2026-03-24');
      expect(edition.editionType).toEqual('daily');
      expect(edition.status).toEqual('pending');
      expect(edition.pipelineRunId).toBeNull();
      expect(edition.heroImagePath).toBeNull();
      expect(edition.id).toBeGreaterThan(0);
    });

    it('is idempotent — returns existing edition on second call', async () => {
      const first = await ensureEdition(conn, '2026-03-24');
      const second = await ensureEdition(conn, '2026-03-24');

      expect(second.id).toEqual(first.id);
    });
  });

  describe('getEditionByDate', () => {
    it('returns null when no edition exists', async () => {
      const result = await getEditionByDate(conn, '2026-01-01');
      expect(result).toBeNull();
    });

    it('returns the edition for the given date', async () => {
      await ensureEdition(conn, '2026-03-24');
      const result = await getEditionByDate(conn, '2026-03-24');

      expect(result).not.toBeNull();
      expect(result!.editionDate).toContain('2026-03-24');
    });
  });

  describe('getLatestEdition', () => {
    it('returns null when no editions exist', async () => {
      const result = await getLatestEdition(conn);
      expect(result).toBeNull();
    });

    it('returns the most recent edition by date', async () => {
      await ensureEdition(conn, '2026-03-22');
      await ensureEdition(conn, '2026-03-24');
      await ensureEdition(conn, '2026-03-23');

      const latest = await getLatestEdition(conn);
      expect(latest!.editionDate).toContain('2026-03-24');
    });
  });

  describe('listEditions', () => {
    it('returns editions ordered by date descending with pagination', async () => {
      await ensureEdition(conn, '2026-03-22');
      await ensureEdition(conn, '2026-03-23');
      await ensureEdition(conn, '2026-03-24');

      const page1 = await listEditions(conn, 2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0]!.editionDate).toContain('2026-03-24');
      expect(page1[1]!.editionDate).toContain('2026-03-23');

      const page2 = await listEditions(conn, 2, 2);
      expect(page2).toHaveLength(1);
      expect(page2[0]!.editionDate).toContain('2026-03-22');
    });
  });

  describe('updateEditionStatus', () => {
    it('updates the status of an edition', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await updateEditionStatus(conn, edition.id, 'generating');

      const updated = await getEditionByDate(conn, '2026-03-24');
      expect(updated!.status).toEqual('generating');
    });
  });

  // ── Article CRUD ──────────────────────────────────────────────────

  describe('upsertArticle', () => {
    it('creates a new article', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      const article = await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        headline: 'Test Headline',
        body: 'Test body content.',
        displayOrder: 1,
        status: 'generated',
      });

      expect(article.editionId).toEqual(edition.id);
      expect(article.contentType).toEqual('daily_digest');
      expect(article.slug).toEqual('three-miles-up');
      expect(article.headline).toEqual('Test Headline');
      expect(article.body).toEqual('Test body content.');
      expect(article.displayOrder).toEqual(1);
      expect(article.status).toEqual('generated');
    });

    it('updates an existing article on conflict (same edition_id + slug)', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        headline: 'Original',
        body: 'Original body.',
        displayOrder: 1,
        status: 'pending',
      });

      const updated = await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        headline: 'Updated Headline',
        body: 'Updated body.',
        displayOrder: 1,
        status: 'generated',
      });

      expect(updated.headline).toEqual('Updated Headline');
      expect(updated.body).toEqual('Updated body.');
      expect(updated.status).toEqual('generated');
    });
  });

  describe('getArticlesByEdition', () => {
    it('returns articles ordered by display_order', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');

      await upsertArticle(conn, edition.id, {
        contentType: 'editorial',
        slug: 'editorial',
        body: 'Editorial content.',
        displayOrder: 3,
      });
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        body: 'Digest content.',
        displayOrder: 1,
      });
      await upsertArticle(conn, edition.id, {
        contentType: 'fake_ad',
        slug: 'ad-1',
        body: 'Ad content.',
        displayOrder: 2,
      });

      const articles = await getArticlesByEdition(conn, edition.id);
      expect(articles).toHaveLength(3);
      expect(articles.map((a) => a.displayOrder)).toEqual([1, 2, 3]);
      expect(articles.map((a) => a.slug)).toEqual([
        'three-miles-up',
        'ad-1',
        'editorial',
      ]);
    });

    it('returns empty array when no articles exist', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      const articles = await getArticlesByEdition(conn, edition.id);
      expect(articles).toEqual([]);
    });
  });

  describe('getArticle', () => {
    it('returns null when article does not exist', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      const result = await getArticle(conn, edition.id, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns the article by edition and slug', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        headline: 'Found',
        body: 'Found body.',
      });

      const article = await getArticle(conn, edition.id, 'three-miles-up');
      expect(article).not.toBeNull();
      expect(article!.headline).toEqual('Found');
    });
  });

  describe('resetArticle', () => {
    it('sets article status back to pending', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'three-miles-up',
        body: 'Content.',
        status: 'generated',
      });

      await resetArticle(conn, edition.id, 'three-miles-up');

      const article = await getArticle(conn, edition.id, 'three-miles-up');
      expect(article!.status).toEqual('pending');
    });
  });
});
