import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { ensureEdition, upsertArticle } from '../repository.ts';
import { generateHeroImage, type HeroImageOptions } from './hero-image.ts';
import type { BedrockClientLike } from '../../inference/bedrock-client.ts';
import type { ImageGenerationResponse } from '../../inference/types.ts';

// ── Mock helpers ────────────────────────────────────────────────────

const FAKE_IMAGE: Buffer = Buffer.from('fake-webp-data');

function makeMockImageClient(
  overrides?: Partial<ImageGenerationResponse>,
): BedrockClientLike {
  return {
    converse: vi.fn(),
    converseStream: vi.fn() as unknown as BedrockClientLike['converseStream'],
    embed: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({
      images: [FAKE_IMAGE],
      latencyMs: 200,
      ...overrides,
    } satisfies ImageGenerationResponse),
  };
}

function makeMockConfig(
  overrides: Record<string, string> = {},
): HeroImageOptions['config'] {
  const defaults: Record<string, string> = {
    newspaperImageModel: 'amazon.nova-canvas-v1:0',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  } as unknown as HeroImageOptions['config'];
}

// ── Tests ───────────────────────────────────────────────────────────

describe('generateHeroImage', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let editionId: number;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);

    const edition = await ensureEdition(conn, '2026-03-24');
    editionId = edition.id;

    // Use a temp dir so file writes don't pollute the project
    tmpDir = join(tmpdir(), `hero-image-test-${Date.now()}`);
  });

  afterEach(async () => {
    conn.closeSync();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when daily digest has not been generated', async () => {
    const imageClient: BedrockClientLike = makeMockImageClient();

    await expect(
      generateHeroImage({
        conn,
        editionId,
        editionDate: '2026-03-24',
        inferenceService: {} as HeroImageOptions['inferenceService'],
        config: makeMockConfig(),
        imageClient,
        log: vi.fn(),
      }),
    ).rejects.toThrow('Daily digest must be generated before hero image');
  });

  it('throws when daily digest exists but is not generated status', async () => {
    await upsertArticle(conn, editionId, {
      contentType: 'daily_digest',
      slug: 'three-miles-up',
      body: 'Some pending content',
      status: 'pending',
    });

    const imageClient: BedrockClientLike = makeMockImageClient();

    await expect(
      generateHeroImage({
        conn,
        editionId,
        editionDate: '2026-03-24',
        inferenceService: {} as HeroImageOptions['inferenceService'],
        config: makeMockConfig(),
        imageClient,
        log: vi.fn(),
      }),
    ).rejects.toThrow('Daily digest must be generated before hero image');
  });

  it('generates hero image with engraving style prompt from digest', async () => {
    // Insert a generated daily digest
    await upsertArticle(conn, editionId, {
      contentType: 'daily_digest',
      slug: 'three-miles-up',
      headline: 'Busy Day at the Bureau',
      body: 'The FCC received several notable filings today involving satellite orbital licenses and spectrum allocation disputes.',
      status: 'generated',
      generatedBy: 'test-model',
    });

    const imageClient: BedrockClientLike = makeMockImageClient();

    const result = await generateHeroImage({
      conn,
      editionId,
      editionDate: '2026-03-24',
      inferenceService: {} as HeroImageOptions['inferenceService'],
      config: makeMockConfig(),
      imageClient,
      log: vi.fn(),
      _dataDir: tmpDir,
    });

    // Verify generateImage was called with correct style
    expect(imageClient.generateImage).toHaveBeenCalledOnce();
    const call = vi.mocked(imageClient.generateImage).mock.calls[0]![0]!;
    expect(call.modelId).toEqual('amazon.nova-canvas-v1:0');
    expect(call.prompt).toContain('Steel engraving illustration');
    expect(call.prompt).toContain('crosshatch');
    expect(call.prompt).toContain('Scene depicting:');
    expect(call.prompt).toContain('FCC received several notable filings');
    expect(call.negativePrompt).toContain('photograph');
    expect(call.width).toEqual(1024);
    expect(call.height).toEqual(768);

    // Verify file was written
    const expectedPath: string = join(
      tmpDir,
      'newspaper',
      'images',
      '2026-03-24',
      'hero.webp',
    );
    const written: Buffer = await readFile(expectedPath);
    expect(written).toEqual(FAKE_IMAGE);

    // Verify result structure
    expect(result.imagePath).toEqual(expectedPath);
    expect(result.imagePrompt).toContain('Steel engraving');
    expect(result.sourceData).toEqual({
      digestSlug: 'three-miles-up',
      modelId: 'amazon.nova-canvas-v1:0',
    });
    expect(result.headline).toEqual('');
    expect(result.body).toEqual('');
  });
});
