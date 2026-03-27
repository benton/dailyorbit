import { describe, expect, test } from 'vitest';
import {
  buildEditionImageUrls,
  buildLibraryImageUrls,
} from './image-health.ts';
import type { NewspaperArticle } from './types.ts';

// ── Helpers ──────────────────────────────────────────────────────────

function makeArticle(
  overrides: Partial<NewspaperArticle> = {},
): NewspaperArticle {
  return {
    id: 1,
    editionId: 1,
    contentType: 'hero_image',
    slug: 'hero-image',
    headline: 'Test',
    body: 'body',
    sourceData: null,
    generatedBy: null,
    imagePath: null,
    imagePrompt: null,
    displayOrder: 0,
    status: 'generated',
    createdAt: '2026-03-25T00:00:00Z',
    updatedAt: '2026-03-25T00:00:00Z',
    ...overrides,
  };
}

// ── buildEditionImageUrls ────────────────────────────────────────────

describe('buildEditionImageUrls', () => {
  const baseUrl: string = 'https://dailyorbit.org/newspaper';
  const date: string = '2026-03-25';

  test('extracts URLs from articles with imagePath', () => {
    const articles: NewspaperArticle[] = [
      makeArticle({
        slug: 'hero-image',
        imagePath: 'data/newspaper/images/2026-03-25/hero-abc.webp',
      }),
      makeArticle({
        slug: 'editorial-cartoon',
        imagePath: 'data/newspaper/images/2026-03-25/cartoon-def.webp',
      }),
    ];

    const result = buildEditionImageUrls(baseUrl, date, articles);

    expect(result).toEqual([
      {
        url: 'https://dailyorbit.org/newspaper/images/2026-03-25/hero-abc.webp',
        label: '2026-03-25/hero-image',
      },
      {
        url: 'https://dailyorbit.org/newspaper/images/2026-03-25/cartoon-def.webp',
        label: '2026-03-25/editorial-cartoon',
      },
    ]);
  });

  test('skips articles without imagePath', () => {
    const articles: NewspaperArticle[] = [
      makeArticle({ slug: 'digest', imagePath: null }),
      makeArticle({
        slug: 'hero-image',
        imagePath: 'data/newspaper/images/2026-03-25/hero-abc.webp',
      }),
      makeArticle({ slug: 'classifieds', imagePath: null }),
    ];

    const result = buildEditionImageUrls(baseUrl, date, articles);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('2026-03-25/hero-image');
  });

  test('returns empty array when no articles have images', () => {
    const articles: NewspaperArticle[] = [
      makeArticle({ imagePath: null }),
      makeArticle({ imagePath: null }),
    ];

    expect(buildEditionImageUrls(baseUrl, date, articles)).toEqual([]);
  });

  test('returns empty array for empty article list', () => {
    expect(buildEditionImageUrls(baseUrl, date, [])).toEqual([]);
  });
});

// ── buildLibraryImageUrls ────────────────────────────────────────────

describe('buildLibraryImageUrls', () => {
  const baseUrl: string = 'https://dailyorbit.org/newspaper';

  test('builds URLs for all library paths', () => {
    const paths: string[] = [
      'library/portraits/alex-chen.webp',
      'library/headers/three-miles-up.webp',
      'library/house-ads/ad-01.webp',
    ];

    const result = buildLibraryImageUrls(baseUrl, paths);

    expect(result).toEqual([
      {
        url: 'https://dailyorbit.org/newspaper/images/library/portraits/alex-chen.webp',
        label: 'library/portraits/alex-chen.webp',
      },
      {
        url: 'https://dailyorbit.org/newspaper/images/library/headers/three-miles-up.webp',
        label: 'library/headers/three-miles-up.webp',
      },
      {
        url: 'https://dailyorbit.org/newspaper/images/library/house-ads/ad-01.webp',
        label: 'library/house-ads/ad-01.webp',
      },
    ]);
  });

  test('returns empty array for empty paths', () => {
    expect(buildLibraryImageUrls(baseUrl, [])).toEqual([]);
  });
});
