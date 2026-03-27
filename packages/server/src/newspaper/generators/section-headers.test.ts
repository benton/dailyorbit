import { existsSync } from 'node:fs';
import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { getImageByPath } from '../repository.ts';
import type { ConfigService } from '../../lib/config-service.ts';
import type { ImageClient } from './portrait-library.ts';
import {
  generateSectionHeaders,
  HEADER_STYLE,
  SECTION_HEADERS,
} from './section-headers.ts';

function createMockImageClient(): ImageClient {
  return {
    generateImage: vi.fn().mockResolvedValue({
      images: [Buffer.from('fake-header-data')],
      latencyMs: 100,
    }),
  };
}

function createMockConfig(): ConfigService {
  return {
    get: vi.fn().mockReturnValue('amazon.nova-canvas-v1:0'),
  } as unknown as ConfigService;
}

describe('section header generator', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    tmpDir = await mkdtemp(join(tmpdir(), 'header-test-'));
  });

  afterEach(async () => {
    conn.closeSync();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates all section headers, writes files, and inserts DB records', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();
    const logs: string[] = [];

    const result = await generateSectionHeaders(
      conn,
      client,
      config,
      (msg: string) => logs.push(msg),
      { dataDir: tmpDir },
    );

    expect(result).toEqual({
      generated: SECTION_HEADERS.length,
      skipped: 0,
      failed: 0,
    });
    expect(client.generateImage).toHaveBeenCalledTimes(SECTION_HEADERS.length);

    // Verify files are named by section name
    for (const entry of SECTION_HEADERS) {
      const filePath: string = join(
        tmpDir,
        'newspaper',
        'images',
        'library',
        'headers',
        `${entry.name}.webp`,
      );
      expect(existsSync(filePath)).toBe(true);
    }

    // Verify DB records
    for (const entry of SECTION_HEADERS) {
      const imagePath: string = join(
        tmpDir,
        'newspaper',
        'images',
        'library',
        'headers',
        `${entry.name}.webp`,
      );
      const record = await getImageByPath(conn, imagePath);
      expect(record).not.toBeNull();
      expect(record!.imageType).toEqual('section_header');
      expect(record!.tags).toEqual([entry.name]);
    }

    expect(logs).toHaveLength(SECTION_HEADERS.length);
  });

  it('constructs prompts with header style prefix at 800x200', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    await generateSectionHeaders(conn, client, config, () => {}, {
      dataDir: tmpDir,
    });

    const firstCall = (client.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(firstCall.prompt).toEqual(HEADER_STYLE + SECTION_HEADERS[0]!.prompt);
    expect(firstCall.width).toEqual(1024);
    expect(firstCall.height).toEqual(320);
  });

  it('skips already-existing headers (idempotent)', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    // Generate all
    await generateSectionHeaders(conn, client, config, () => {}, {
      dataDir: tmpDir,
    });

    (client.generateImage as ReturnType<typeof vi.fn>).mockClear();

    // Run again — all should be skipped
    const result = await generateSectionHeaders(
      conn,
      client,
      config,
      () => {},
      { dataDir: tmpDir },
    );

    expect(result).toEqual({
      generated: 0,
      skipped: SECTION_HEADERS.length,
      failed: 0,
    });
    expect(client.generateImage).toHaveBeenCalledTimes(0);
  });

  it('has exactly 22 section headers', () => {
    expect(SECTION_HEADERS).toHaveLength(22);
  });

  it('has unique section header names', () => {
    const names: string[] = SECTION_HEADERS.map((h) => h.name);
    expect(new Set(names).size).toEqual(names.length);
  });
});
