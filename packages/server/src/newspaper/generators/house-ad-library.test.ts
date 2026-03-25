import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import {
  countHouseAds,
  getHouseAdForDate,
  listHouseAds,
} from '../repository.ts';
import type { ConfigService } from '../../lib/config-service.ts';
import type { ImageClient } from './house-ad-library.ts';
import {
  generateHouseAdImages,
  insertHouseAdEntries,
  parseHouseAdResponse,
} from './house-ad-library.ts';
import type { HouseAdEntry } from './house-ad-library.ts';

function createMockImageClient(): ImageClient {
  return {
    generateImage: vi.fn().mockResolvedValue({
      images: [Buffer.from('fake-house-ad-image')],
      latencyMs: 50,
    }),
  };
}

function createMockConfig(): ConfigService {
  return {
    get: vi.fn().mockReturnValue('amazon.nova-canvas-v1:0'),
  } as unknown as ConfigService;
}

const SAMPLE_ENTRIES: HouseAdEntry[] = [
  {
    tagline: 'Are Your Orbital Slots Properly Filed?',
    imagePrompt:
      'Victorian gentleman peering through telescope at night sky. Steel engraving style, black ink crosshatch on white background, style of 19th century newspaper illustration, no text, no words.',
  },
  {
    tagline: 'Do Not Let the Competition Seize Your Frequencies!',
    imagePrompt:
      'Two gentlemen in top hats boxing over a radio tower. Steel engraving style, black ink crosshatch on white background, style of 19th century newspaper illustration, no text, no words.',
  },
  {
    tagline: 'Intelligence of the Highest Calibre, Delivered Daily',
    imagePrompt:
      'Newspaper boy waving broadsheet on street corner with satellite dish in background. Steel engraving style, black ink crosshatch on white background, style of 19th century newspaper illustration, no text, no words.',
  },
];

// ── parseHouseAdResponse tests ──────────────────────────────────

describe('parseHouseAdResponse', () => {
  it('parses valid JSON array of tagline/imagePrompt objects', () => {
    const input: string = JSON.stringify(SAMPLE_ENTRIES);
    const result: HouseAdEntry[] = parseHouseAdResponse(input);

    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it('strips markdown fences before parsing', () => {
    const input: string = `\`\`\`json\n${JSON.stringify(SAMPLE_ENTRIES)}\n\`\`\``;
    const result: HouseAdEntry[] = parseHouseAdResponse(input);

    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it('trims whitespace from taglines and image prompts', () => {
    const input: string = JSON.stringify([
      { tagline: '  Padded Tagline  ', imagePrompt: '  Padded Prompt  ' },
    ]);
    const result: HouseAdEntry[] = parseHouseAdResponse(input);

    expect(result).toEqual([
      { tagline: 'Padded Tagline', imagePrompt: 'Padded Prompt' },
    ]);
  });

  it('throws on non-array JSON', () => {
    expect(() => parseHouseAdResponse('{"tagline": "test"}')).toThrow(
      'Expected JSON array',
    );
  });

  it('throws on malformed JSON', () => {
    expect(() => parseHouseAdResponse('not json at all')).toThrow();
  });

  it('throws on entry missing tagline', () => {
    const input: string = JSON.stringify([{ imagePrompt: 'test' }]);
    expect(() => parseHouseAdResponse(input)).toThrow(
      'Invalid house ad entry at index 0',
    );
  });

  it('throws on entry missing imagePrompt', () => {
    const input: string = JSON.stringify([{ tagline: 'test' }]);
    expect(() => parseHouseAdResponse(input)).toThrow(
      'Invalid house ad entry at index 0',
    );
  });

  it('throws on null entry in array', () => {
    const input: string = JSON.stringify([null]);
    expect(() => parseHouseAdResponse(input)).toThrow(
      'Invalid house ad entry at index 0',
    );
  });

  it('handles empty array', () => {
    const result: HouseAdEntry[] = parseHouseAdResponse('[]');
    expect(result).toEqual([]);
  });

  it('salvages complete entries from truncated JSON', () => {
    const full: string = JSON.stringify(SAMPLE_ENTRIES);
    // Chop off the last entry mid-string to simulate LLM truncation
    const truncated: string =
      full.slice(0, full.lastIndexOf('},{') + 2) + '"tagline": "trun';
    const result: HouseAdEntry[] = parseHouseAdResponse(truncated);

    // Should recover the first 2 entries
    expect(result).toHaveLength(2);
    expect(result[0]!.tagline).toBe(SAMPLE_ENTRIES[0]!.tagline);
    expect(result[1]!.tagline).toBe(SAMPLE_ENTRIES[1]!.tagline);
  });

  it('throws when truncated JSON has no complete entries', () => {
    const truncated: string = '[{"tagline": "incompl';
    expect(() => parseHouseAdResponse(truncated)).toThrow(
      'no complete entries found',
    );
  });
});

// ── generateHouseAdImages tests ─────────────────────────────────

describe('generateHouseAdImages', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    tmpDir = await mkdtemp(join(tmpdir(), 'house-ad-test-'));
  });

  afterEach(async () => {
    conn.closeSync();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates images and inserts DB records for each entry', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    const result = await generateHouseAdImages(
      SAMPLE_ENTRIES,
      conn,
      client,
      config,
      () => {},
      { dataDir: tmpDir },
    );

    expect(result).toEqual({
      generated: SAMPLE_ENTRIES.length,
      skipped: 0,
      failed: 0,
    });
    expect(client.generateImage).toHaveBeenCalledTimes(SAMPLE_ENTRIES.length);
  });

  it('skips entries that already have images in DB', async () => {
    const client: ImageClient = createMockImageClient();
    const config: ConfigService = createMockConfig();

    // First run generates all
    await generateHouseAdImages(
      SAMPLE_ENTRIES,
      conn,
      client,
      config,
      () => {},
      {
        dataDir: tmpDir,
      },
    );

    // Second run skips all
    const result = await generateHouseAdImages(
      SAMPLE_ENTRIES,
      conn,
      client,
      config,
      () => {},
      { dataDir: tmpDir },
    );

    expect(result).toEqual({
      generated: 0,
      skipped: SAMPLE_ENTRIES.length,
      failed: 0,
    });
  });
});

// ── insertHouseAdEntries + repository tests ─────────────────────

describe('house ad repository', () => {
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

  it('inserts entries and counts them', async () => {
    const result = await insertHouseAdEntries(
      SAMPLE_ENTRIES,
      conn,
      'test-model',
      () => {},
      { dataDir: '/tmp/fake' },
    );

    expect(result).toEqual({
      inserted: SAMPLE_ENTRIES.length,
      skipped: 0,
    });
    expect(await countHouseAds(conn)).toBe(SAMPLE_ENTRIES.length);
  });

  it('skips duplicate taglines on re-insert (idempotent)', async () => {
    await insertHouseAdEntries(SAMPLE_ENTRIES, conn, 'test-model', () => {}, {
      dataDir: '/tmp/fake',
    });
    const result = await insertHouseAdEntries(
      SAMPLE_ENTRIES,
      conn,
      'test-model',
      () => {},
      { dataDir: '/tmp/fake' },
    );

    expect(result).toEqual({
      inserted: 0,
      skipped: SAMPLE_ENTRIES.length,
    });
    expect(await countHouseAds(conn)).toBe(SAMPLE_ENTRIES.length);
  });

  it('lists all house ads ordered by id', async () => {
    await insertHouseAdEntries(SAMPLE_ENTRIES, conn, 'test-model', () => {}, {
      dataDir: '/tmp/fake',
    });
    const ads = await listHouseAds(conn);

    expect(ads).toHaveLength(SAMPLE_ENTRIES.length);
    expect(ads[0]!.tagline).toBe(SAMPLE_ENTRIES[0]!.tagline);
    expect(ads[1]!.tagline).toBe(SAMPLE_ENTRIES[1]!.tagline);
    expect(ads[2]!.tagline).toBe(SAMPLE_ENTRIES[2]!.tagline);
  });

  describe('getHouseAdForDate deterministic selection', () => {
    beforeEach(async () => {
      await insertHouseAdEntries(SAMPLE_ENTRIES, conn, 'test-model', () => {}, {
        dataDir: '/tmp/fake',
      });
    });

    it('returns the same ad for the same date', async () => {
      const ad1 = await getHouseAdForDate(conn, '2026-03-25');
      const ad2 = await getHouseAdForDate(conn, '2026-03-25');

      expect(ad1).not.toBeNull();
      expect(ad1!.tagline).toBe(ad2!.tagline);
    });

    it('rotates through ads for different dates', async () => {
      const taglines: Set<string> = new Set();
      // Check enough dates to see rotation across 3 entries
      for (let day: number = 1; day <= 10; day++) {
        const date: string = `2026-01-${String(day).padStart(2, '0')}`;
        const ad = await getHouseAdForDate(conn, date);
        if (ad) taglines.add(ad.tagline);
      }
      // With 3 ads and 10 different days, we should see multiple different taglines
      expect(taglines.size).toBeGreaterThan(1);
    });

    it('returns null when no house ads exist', async () => {
      // Use a fresh DB with no ads
      const freshDb: DuckDBInstance = await DuckDBInstance.create(':memory:');
      const freshConn: DuckDBConnection =
        await DuckDBConnection.create(freshDb);
      await ensureNewspaperTables(freshConn);

      const ad = await getHouseAdForDate(freshConn, '2026-03-25');
      expect(ad).toBeNull();
      freshConn.closeSync();
    });
  });
});
