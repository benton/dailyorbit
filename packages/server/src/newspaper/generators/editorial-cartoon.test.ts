import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { upsertArticle } from '../repository.ts';
import type { InferenceResponse } from '../../inference/types.ts';
import { generateEditorialCartoon } from './editorial-cartoon.ts';
import type { EditorialCartoonOptions } from './editorial-cartoon.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
      stopReason: 'end_turn',
      latencyMs: 30,
    } satisfies InferenceResponse),
  };
}

function makeMockImageClient() {
  return {
    generateImage: vi.fn().mockResolvedValue({
      images: [Buffer.from('fake-image-data')],
    }),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperImageModel: 'test-image-model',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('generateEditorialCartoon', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    tmpDir = await mkdtemp(join(tmpdir(), 'cartoon-test-'));

    // Create a test edition
    await conn.run(
      `INSERT INTO newspaper_edition (id, edition_date) VALUES (1, '2026-03-24')`,
    );

    // Create the prerequisite editorial article
    await upsertArticle(conn, 1, {
      contentType: 'editorial',
      slug: 'over-the-horizon',
      headline: 'The Shifting Orbital Order',
      body: 'The past week reveals a familiar pattern of consolidation in the satellite industry. Hughes and SpaceX continue to file aggressively while smaller operators find creative ways to compete for orbital slots.',
      status: 'generated',
    });
  });

  afterEach(async () => {
    conn.closeSync();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates a cartoon from the editorial content', async () => {
    const inferenceService = makeMockInferenceService(
      'A portly gentleman in a top hat representing Big Satellite sits atop a towering stack of FCC filing folders.',
    );
    const imageClient = makeMockImageClient();
    const config = makeMockConfig();

    const result = await generateEditorialCartoon({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as EditorialCartoonOptions['inferenceService'],
      imageClient:
        imageClient as unknown as EditorialCartoonOptions['imageClient'],
      config: config as unknown as EditorialCartoonOptions['config'],
      log: vi.fn(),
      _dataDir: tmpDir,
    });

    expect(result.imagePath).toContain('editorial-cartoon.webp');
    expect(result.imagePrompt).toContain('Punch magazine');
    expect(result.sourceData.editorialSlug).toEqual('over-the-horizon');
  });

  it('throws when no editorial exists in any edition', async () => {
    // Remove all editorials so neither current nor fallback is found
    await conn.run(
      `DELETE FROM newspaper_article WHERE slug = 'over-the-horizon'`,
    );

    const inferenceService = makeMockInferenceService('');
    const imageClient = makeMockImageClient();
    const config = makeMockConfig();

    await expect(
      generateEditorialCartoon({
        conn,
        editionId: 1,
        editionDate: '2026-03-24',
        inferenceService:
          inferenceService as unknown as EditorialCartoonOptions['inferenceService'],
        imageClient:
          imageClient as unknown as EditorialCartoonOptions['imageClient'],
        config: config as unknown as EditorialCartoonOptions['config'],
        log: vi.fn(),
        _dataDir: tmpDir,
      }),
    ).rejects.toThrow('No editorial found in any edition');
  });

  it('falls back to a recent editorial from a prior edition', async () => {
    // Create a second edition with no editorial
    await conn.run(
      `INSERT INTO newspaper_edition (id, edition_date) VALUES (2, '2026-03-25')`,
    );

    const inferenceService = makeMockInferenceService(
      'A satellite balanced on a tightrope between two orbital slots.',
    );
    const imageClient = makeMockImageClient();
    const config = makeMockConfig();

    // Generate cartoon for edition 2 — should fall back to edition 1's editorial
    const result = await generateEditorialCartoon({
      conn,
      editionId: 2,
      editionDate: '2026-03-25',
      inferenceService:
        inferenceService as unknown as EditorialCartoonOptions['inferenceService'],
      imageClient:
        imageClient as unknown as EditorialCartoonOptions['imageClient'],
      config: config as unknown as EditorialCartoonOptions['config'],
      log: vi.fn(),
      _dataDir: tmpDir,
    });

    expect(result.imagePath).toContain('editorial-cartoon.webp');
    expect(result.sourceData.editorialSlug).toEqual('over-the-horizon');
  });

  it('calls image generation at 512x512 with cartoon style', async () => {
    const inferenceService = makeMockInferenceService(
      'A satellite dish disguised as a Victorian parasol.',
    );
    const imageClient = makeMockImageClient();
    const config = makeMockConfig();

    await generateEditorialCartoon({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as EditorialCartoonOptions['inferenceService'],
      imageClient:
        imageClient as unknown as EditorialCartoonOptions['imageClient'],
      config: config as unknown as EditorialCartoonOptions['config'],
      log: vi.fn(),
      _dataDir: tmpDir,
    });

    const imageCall = imageClient.generateImage.mock.calls[0]![0]!;
    expect(imageCall.width).toEqual(512);
    expect(imageCall.height).toEqual(512);
    expect(imageCall.prompt).toContain('Punch magazine');
    expect(imageCall.prompt).toContain('Victorian parasol');
  });
});
