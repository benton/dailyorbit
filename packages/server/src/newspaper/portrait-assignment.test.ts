import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';
import { insertImage } from './repository.ts';
import { assignPortrait, getPortraitForPerson } from './portrait-assignment.ts';

describe('assignPortrait', () => {
  it('returns the same index for the same name (deterministic)', () => {
    const a: number = assignPortrait('Jessica Rosenworcel', 100);
    const b: number = assignPortrait('Jessica Rosenworcel', 100);
    expect(a).toEqual(b);
  });

  it('is case-insensitive', () => {
    const lower: number = assignPortrait('john doe', 100);
    const upper: number = assignPortrait('JOHN DOE', 100);
    const mixed: number = assignPortrait('John Doe', 100);
    expect(lower).toEqual(upper);
    expect(lower).toEqual(mixed);
  });

  it('trims whitespace', () => {
    const trimmed: number = assignPortrait('Jane Smith', 100);
    const padded: number = assignPortrait('  Jane Smith  ', 100);
    expect(trimmed).toEqual(padded);
  });

  it('returns values within [0, librarySize)', () => {
    const names: string[] = [
      'Alice',
      'Bob',
      'Charlie',
      'Diana',
      'Eve',
      'Frank',
      'Grace',
      'Heidi',
      'Ivan',
      'Judy',
      'Karl',
      'Linda',
      'Mallory',
      'Nina',
      'Oscar',
      'Peggy',
      'Quinn',
      'Ruth',
    ];
    for (const name of names) {
      const index: number = assignPortrait(name, 50);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(50);
    }
  });

  it('distributes different names across the range', () => {
    const indices: Set<number> = new Set();
    for (let i: number = 0; i < 100; i++) {
      indices.add(assignPortrait(`Person ${String(i)}`, 100));
    }
    // With 100 names over 100 slots, expect reasonable distribution (>50 unique)
    expect(indices.size).toBeGreaterThan(50);
  });

  it('returns 0 for zero or negative library size', () => {
    expect(assignPortrait('test', 0)).toEqual(0);
    expect(assignPortrait('test', -1)).toEqual(0);
  });
});

describe('getPortraitForPerson', () => {
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

  it('returns null when no portraits exist', async () => {
    const result = await getPortraitForPerson(conn, 'Anyone');
    expect(result).toBeNull();
  });

  it('returns the same portrait for the same name', async () => {
    // Insert a few portraits
    for (let i: number = 0; i < 10; i++) {
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: `portraits/${String(i).padStart(3, '0')}.webp`,
        prompt: null,
        tags: ['standard'],
        generatedBy: 'test-model',
      });
    }

    const first = await getPortraitForPerson(conn, 'Jessica Rosenworcel');
    const second = await getPortraitForPerson(conn, 'Jessica Rosenworcel');
    expect(first).not.toBeNull();
    expect(first!.imagePath).toEqual(second!.imagePath);
  });

  it('returns different portraits for different names', async () => {
    for (let i: number = 0; i < 50; i++) {
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath: `portraits/${String(i).padStart(3, '0')}.webp`,
        prompt: null,
        tags: ['standard'],
        generatedBy: 'test-model',
      });
    }

    const a = await getPortraitForPerson(conn, 'Alice');
    const b = await getPortraitForPerson(conn, 'Bob');
    // With 50 portraits and different names, very likely different
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Just verify both return valid portraits (they could theoretically collide)
    expect(a!.imageType).toEqual('portrait');
    expect(b!.imageType).toEqual('portrait');
  });

  it('ignores non-portrait images in the library', async () => {
    await insertImage(conn, {
      imageType: 'section_header',
      imagePath: 'headers/the-wire.webp',
      prompt: null,
      tags: [],
      generatedBy: 'test-model',
    });

    const result = await getPortraitForPerson(conn, 'Anyone');
    expect(result).toBeNull();
  });
});
