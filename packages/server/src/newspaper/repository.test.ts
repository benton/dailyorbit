import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';
import {
  countImagesByType,
  deleteEdition,
  ensureEdition,
  getArticle,
  getArticlesByEdition,
  getEditionByDate,
  getImageByPath,
  getLatestEdition,
  insertImage,
  listEditions,
  listImagesByType,
  publishEdition,
  resetArticle,
  unpublishEdition,
  updateArticle,
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

    it('returns the most recent published edition by date', async () => {
      const ed1 = await ensureEdition(conn, '2026-03-22');
      await updateEditionStatus(conn, ed1.id, 'complete');
      await publishEdition(conn, '2026-03-22');

      const ed2 = await ensureEdition(conn, '2026-03-24');
      await updateEditionStatus(conn, ed2.id, 'complete');
      await publishEdition(conn, '2026-03-24');

      const ed3 = await ensureEdition(conn, '2026-03-23');
      await updateEditionStatus(conn, ed3.id, 'complete');
      await publishEdition(conn, '2026-03-23');

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

  // ── Image Library CRUD ──────────────────────────────────────────

  describe('insertImage', () => {
    it('inserts and returns an image record with all fields', async () => {
      const image = await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'data/newspaper/images/library/portraits/000.webp',
        prompt: 'Steel engraving portrait bust, young man',
        tags: ['standard', 'male', 'young'],
        generatedBy: 'amazon.nova-canvas-v1:0',
      });

      expect(image.id).toBeGreaterThan(0);
      expect(image.imageType).toEqual('portrait');
      expect(image.imagePath).toEqual(
        'data/newspaper/images/library/portraits/000.webp',
      );
      expect(image.prompt).toEqual('Steel engraving portrait bust, young man');
      expect(image.tags).toEqual(['standard', 'male', 'young']);
      expect(image.generatedBy).toEqual('amazon.nova-canvas-v1:0');
    });

    it('assigns unique sequential ids', async () => {
      const a = await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'portraits/000.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });
      const b = await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'portraits/001.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });

      expect(b.id).toBeGreaterThan(a.id);
    });
  });

  describe('getImageByPath', () => {
    it('returns null when no image exists at path', async () => {
      const result = await getImageByPath(conn, 'nonexistent.webp');
      expect(result).toBeNull();
    });

    it('returns the image for a given path', async () => {
      await insertImage(conn, {
        imageType: 'section_header',
        imagePath: 'headers/the-wire.webp',
        prompt: 'banner prompt',
        tags: [],
        generatedBy: 'model-1',
      });

      const result = await getImageByPath(conn, 'headers/the-wire.webp');
      expect(result).not.toBeNull();
      expect(result!.imageType).toEqual('section_header');
      expect(result!.imagePath).toEqual('headers/the-wire.webp');
    });
  });

  describe('listImagesByType', () => {
    it('returns only images of the requested type, ordered by id', async () => {
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'portraits/000.webp',
        prompt: null,
        tags: ['standard'],
        generatedBy: null,
      });
      await insertImage(conn, {
        imageType: 'section_header',
        imagePath: 'headers/the-wire.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'portraits/001.webp',
        prompt: null,
        tags: ['distinguished'],
        generatedBy: null,
      });

      const portraits = await listImagesByType(conn, 'portrait');
      expect(portraits).toHaveLength(2);
      expect(portraits.map((p) => p.imagePath)).toEqual([
        'portraits/000.webp',
        'portraits/001.webp',
      ]);

      const headers = await listImagesByType(conn, 'section_header');
      expect(headers).toHaveLength(1);
      expect(headers[0]!.imagePath).toEqual('headers/the-wire.webp');
    });

    it('returns empty array when no images of the type exist', async () => {
      const result = await listImagesByType(conn, 'portrait');
      expect(result).toEqual([]);
    });
  });

  describe('countImagesByType', () => {
    it('counts images of a given type', async () => {
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'p/000.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: 'p/001.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });
      await insertImage(conn, {
        imageType: 'section_header',
        imagePath: 'h/wire.webp',
        prompt: null,
        tags: [],
        generatedBy: null,
      });

      expect(await countImagesByType(conn, 'portrait')).toEqual(2);
      expect(await countImagesByType(conn, 'section_header')).toEqual(1);
      expect(await countImagesByType(conn, 'logo')).toEqual(0);
    });
  });

  // ── Publish / Unpublish / Delete ────────────────────────────────

  describe('publishEdition', () => {
    it('publishes a complete edition and sets published_at', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await updateEditionStatus(conn, edition.id, 'complete');

      const result: boolean = await publishEdition(conn, '2026-03-24');
      expect(result).toBe(true);

      const updated = await getEditionByDate(conn, '2026-03-24');
      expect(updated!.publishedAt).not.toBeNull();
    });

    it('returns false for a non-complete edition', async () => {
      await ensureEdition(conn, '2026-03-24');

      const result: boolean = await publishEdition(conn, '2026-03-24');
      expect(result).toBe(false);
    });

    it('returns false for a non-existent edition', async () => {
      const result: boolean = await publishEdition(conn, '2099-01-01');
      expect(result).toBe(false);
    });
  });

  describe('unpublishEdition', () => {
    it('clears published_at on a published edition', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await updateEditionStatus(conn, edition.id, 'complete');
      await publishEdition(conn, '2026-03-24');

      const result: boolean = await unpublishEdition(conn, '2026-03-24');
      expect(result).toBe(true);

      const updated = await getEditionByDate(conn, '2026-03-24');
      expect(updated!.publishedAt).toBeNull();
    });

    it('returns false for a non-existent edition', async () => {
      const result: boolean = await unpublishEdition(conn, '2099-01-01');
      expect(result).toBe(false);
    });
  });

  describe('getLatestEdition (published filter)', () => {
    it('returns the most recent published edition, skipping unpublished', async () => {
      const ed1 = await ensureEdition(conn, '2026-03-22');
      await updateEditionStatus(conn, ed1.id, 'complete');
      await publishEdition(conn, '2026-03-22');

      const ed2 = await ensureEdition(conn, '2026-03-24');
      await updateEditionStatus(conn, ed2.id, 'complete');
      // ed2 is complete but NOT published

      const latest = await getLatestEdition(conn);
      expect(latest!.editionDate).toContain('2026-03-22');
    });

    it('returns null when no editions are published', async () => {
      await ensureEdition(conn, '2026-03-24');

      const latest = await getLatestEdition(conn);
      expect(latest).toBeNull();
    });
  });

  describe('deleteEdition', () => {
    it('deletes edition and its articles, returning image paths', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'digest',
        body: 'Content.',
        imagePath: 'images/2026-03-24/digest.webp',
      });
      await upsertArticle(conn, edition.id, {
        contentType: 'editorial',
        slug: 'editorial',
        body: 'Editorial.',
      });

      const result = await deleteEdition(conn, '2026-03-24');
      expect(result.deleted).toBe(true);
      expect(result.imagePaths).toEqual(['images/2026-03-24/digest.webp']);

      expect(await getEditionByDate(conn, '2026-03-24')).toBeNull();
      expect(await getArticlesByEdition(conn, edition.id)).toEqual([]);
    });

    it('returns deleted: false for a non-existent edition', async () => {
      const result = await deleteEdition(conn, '2099-01-01');
      expect(result).toEqual({ deleted: false, imagePaths: [] });
    });
  });

  describe('updateArticle', () => {
    it('updates headline only', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'digest',
        headline: 'Original',
        body: 'Original body.',
      });

      const updated = await updateArticle(conn, edition.id, 'digest', {
        headline: 'New Headline',
      });
      expect(updated!.headline).toEqual('New Headline');
      expect(updated!.body).toEqual('Original body.');
    });

    it('updates body only', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'digest',
        headline: 'Keep This',
        body: 'Old body.',
      });

      const updated = await updateArticle(conn, edition.id, 'digest', {
        body: 'New body content.',
      });
      expect(updated!.headline).toEqual('Keep This');
      expect(updated!.body).toEqual('New body content.');
    });

    it('updates both headline and body', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'digest',
        headline: 'Old',
        body: 'Old body.',
      });

      const updated = await updateArticle(conn, edition.id, 'digest', {
        headline: 'New',
        body: 'New body.',
      });
      expect(updated!.headline).toEqual('New');
      expect(updated!.body).toEqual('New body.');
    });

    it('returns null for a non-existent article', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      const result = await updateArticle(conn, edition.id, 'nonexistent', {
        headline: 'X',
      });
      expect(result).toBeNull();
    });

    it('returns existing article unchanged when patch is empty', async () => {
      const edition = await ensureEdition(conn, '2026-03-24');
      await upsertArticle(conn, edition.id, {
        contentType: 'daily_digest',
        slug: 'digest',
        headline: 'Keep',
        body: 'Keep body.',
      });

      const result = await updateArticle(conn, edition.id, 'digest', {});
      expect(result!.headline).toEqual('Keep');
      expect(result!.body).toEqual('Keep body.');
    });
  });
});
