import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { getImageByPath } from '../repository.ts';
import type { ConfigService } from '../../lib/config-service.ts';
import type { ImageClient } from './portrait-library.ts';
import {
  generatePortraitLibrary,
  PORTRAIT_PROMPTS,
  PORTRAIT_STYLE,
} from './portrait-library.ts';

function createMockImageClient(): ImageClient {
  return {
    generateImage: vi.fn().mockResolvedValue({
      images: [Buffer.from('fake-image-data')],
      latencyMs: 100,
    }),
  };
}

function createMockConfig(): ConfigService {
  return {
    get: vi.fn().mockReturnValue('amazon.nova-canvas-v1:0'),
  } as unknown as ConfigService;
}

describe('portrait library generator', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    tmpDir = await mkdtemp(join(tmpdir(), 'portrait-test-'));
  });

  afterEach(async () => {
    conn.closeSync();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates portraits, writes files, and inserts DB records', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();
    const logs: string[] = [];

    const result = await generatePortraitLibrary(
      conn,
      client,
      config,
      (msg: string) => logs.push(msg),
      { limit: 3, dataDir: tmpDir },
    );

    expect(result).toEqual({ generated: 3, skipped: 0, failed: 0 });
    expect(client.generateImage).toHaveBeenCalledTimes(3);

    // Verify files exist on disk
    for (let i: number = 0; i < 3; i++) {
      const filePath: string = join(
        tmpDir,
        'newspaper',
        'images',
        'library',
        'portraits',
        `${String(i).padStart(3, '0')}.webp`,
      );
      expect(existsSync(filePath)).toBe(true);
      const contents: Buffer = await readFile(filePath);
      expect(contents.toString()).toEqual('fake-image-data');
    }

    // Verify DB records
    for (let i: number = 0; i < 3; i++) {
      const imagePath: string = join(
        tmpDir,
        'newspaper',
        'images',
        'library',
        'portraits',
        `${String(i).padStart(3, '0')}.webp`,
      );
      const record = await getImageByPath(conn, imagePath);
      expect(record).not.toBeNull();
      expect(record!.imageType).toEqual('portrait');
      expect(record!.tags).toEqual(PORTRAIT_PROMPTS[i]!.tags);
    }

    expect(logs).toHaveLength(3);
  });

  it('constructs prompts with the style prefix', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    await generatePortraitLibrary(conn, client, config, () => {}, {
      limit: 1,
      dataDir: tmpDir,
    });

    const call = (client.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.prompt).toEqual(PORTRAIT_STYLE + PORTRAIT_PROMPTS[0]!.prompt);
    expect(call.negativePrompt).toContain('photograph');
    expect(call.width).toEqual(256);
    expect(call.height).toEqual(320);
    expect(call.seed).toEqual(0); // i=0 * 42
  });

  it('skips already-existing images (idempotent)', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    // Generate first 2 (indices 0,1)
    await generatePortraitLibrary(conn, client, config, () => {}, {
      limit: 2,
      dataDir: tmpDir,
    });

    (client.generateImage as ReturnType<typeof vi.fn>).mockClear();

    // Run again with limit=2 — skips indices 0,1 (already exist),
    // then generates indices 2,3 (2 new). Verifies existing images are not re-generated.
    const result = await generatePortraitLibrary(
      conn,
      client,
      config,
      () => {},
      { limit: 2, dataDir: tmpDir },
    );

    expect(result.skipped).toEqual(2);
    expect(result.generated).toEqual(2);
    expect(result.failed).toEqual(0);
    // Only 2 calls (for new images), not 4 (would be the case without skip logic)
    expect(client.generateImage).toHaveBeenCalledTimes(2);
  });

  it('respects startIndex option', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    const result = await generatePortraitLibrary(
      conn,
      client,
      config,
      () => {},
      { startIndex: 5, limit: 2, dataDir: tmpDir },
    );

    expect(result).toEqual({ generated: 2, skipped: 0, failed: 0 });

    // First call should have seed = 5 * 42
    const firstCall = (client.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(firstCall.seed).toEqual(5 * 42);
  });

  it('handles image generation failures gracefully', async () => {
    const client: ImageClient = {
      generateImage: vi
        .fn()
        .mockResolvedValueOnce({ images: [Buffer.from('ok')], latencyMs: 50 })
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({ images: [Buffer.from('ok')], latencyMs: 50 }),
    };
    const config: ConfigService = createMockConfig();
    const logs: string[] = [];

    // limit=2: index 0 succeeds (gen=1), index 1 fails (fail=1), index 2 succeeds (gen=2, done)
    const result = await generatePortraitLibrary(
      conn,
      client,
      config,
      (msg: string) => logs.push(msg),
      { limit: 2, dataDir: tmpDir },
    );

    expect(result).toEqual({ generated: 2, skipped: 0, failed: 1 });
    expect(logs.some((l: string) => l.includes('failed'))).toBe(true);
  });

  it('has at least 95 portrait prompts', () => {
    expect(PORTRAIT_PROMPTS.length).toBeGreaterThanOrEqual(95);
  });

  it('uses deterministic seeds based on index', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    await generatePortraitLibrary(conn, client, config, () => {}, {
      startIndex: 10,
      limit: 2,
      dataDir: tmpDir,
    });

    const calls = (client.generateImage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].seed).toEqual(10 * 42);
    expect(calls[1]![0].seed).toEqual(11 * 42);
  });

  it('passes the configured model ID to the image client', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = {
      get: vi.fn().mockReturnValue('custom-model-id'),
    } as unknown as ConfigService;

    await generatePortraitLibrary(conn, client, config, () => {}, {
      limit: 1,
      dataDir: tmpDir,
    });

    const call = (client.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.modelId).toEqual('custom-model-id');
  });
});
