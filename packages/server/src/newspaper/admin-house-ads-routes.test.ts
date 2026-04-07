import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';
import { insertHouseAd, listHouseAds } from './repository.ts';
import { mapHouseAdToListItem } from './routes.ts';

describe('mapHouseAdToListItem / admin house-ads list', () => {
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

  it('maps house ad rows to the expected list item shape', async () => {
    const ad1 = await insertHouseAd(conn, {
      tagline: 'Three Miles Up',
      imagePath: 'data/newspaper/images/library/house-ads/three-miles-up.webp',
      imagePrompt: 'Steel engraving satellite',
      generatedBy: 'amazon.nova-canvas-v1:0',
    });

    const ad2 = await insertHouseAd(conn, {
      tagline: 'All the Frequencies',
      imagePath:
        'data/newspaper/images/library/house-ads/all-the-frequencies.webp',
      imagePrompt: 'Radio waves etching',
      generatedBy: null,
    });

    const rows = await listHouseAds(conn);
    const items = rows.map(mapHouseAdToListItem);

    expect(items).toHaveLength(2);

    expect(items[0]).toEqual({
      id: ad1.id,
      tagline: 'Three Miles Up',
      slug: 'three-miles-up',
      htmlPath: `/ads/${String(ad1.id)}-three-miles-up.html`,
      imagePath: `/ads/${String(ad1.id)}-three-miles-up.webp`,
      imageSubpath: `house-ads/three-miles-up.webp`,
    });

    expect(items[1]).toEqual({
      id: ad2.id,
      tagline: 'All the Frequencies',
      slug: 'all-the-frequencies',
      htmlPath: `/ads/${String(ad2.id)}-all-the-frequencies.html`,
      imagePath: `/ads/${String(ad2.id)}-all-the-frequencies.webp`,
      imageSubpath: `house-ads/all-the-frequencies.webp`,
    });
  });

  it('returns an empty list when no house ads exist', async () => {
    const rows = await listHouseAds(conn);
    const items = rows.map(mapHouseAdToListItem);
    expect(items).toEqual([]);
  });
});
