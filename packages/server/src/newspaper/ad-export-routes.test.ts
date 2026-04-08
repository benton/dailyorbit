import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createAdExportRoutes, type AdExportDeps } from './ad-export-routes.ts';

const FAKE_WEBP: Buffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
]);

// IMPORTANT: ad-export-routes.ts confines file reads to data/newspaper/images/library/house-ads
// (HOUSE_ADS_IMAGE_ROOT). Tests must put their fake image inside that directory or the
// path-traversal guard will return 404.

const HOUSE_ADS_DIR: string = resolve(
  'data',
  'newspaper',
  'images',
  'library',
  'house-ads',
);
const TEST_IMAGE_NAME: string = `__test_ad_export_${String(Date.now())}.webp`;
let imagePath: string;
let app: Hono;

beforeAll(async () => {
  await mkdir(HOUSE_ADS_DIR, { recursive: true });
  imagePath = join(HOUSE_ADS_DIR, TEST_IMAGE_NAME);
  await writeFile(imagePath, FAKE_WEBP);

  const deps: AdExportDeps = {
    async lookupAd(id: number) {
      if (id === 7) {
        return {
          id: 7,
          tagline: 'Three Miles Up',
          imagePath,
        };
      }
      return null;
    },
    getDestinationBaseUrl: () => 'https://dailyorbit.org/',
    getAppBaseUrl: () => 'https://dailyorbit.org',
  };

  app = new Hono();
  app.route('/ads', createAdExportRoutes(deps));
});

afterAll(async () => {
  await rm(imagePath, { force: true });
});

describe('GET /ads/:idSlug.html', () => {
  it('serves the canonical HTML with correct headers', async () => {
    const res = await app.request('/ads/7-three-miles-up.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body: string = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('Three Miles Up');
    expect(body).toContain('src="7-three-miles-up.webp"');
    expect(body).toContain('utm_content=ad-7');
  });

  it('redirects bare id .html to canonical id-slug form', async () => {
    const res = await app.request('/ads/7.html');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.html');
  });

  it('redirects wrong-slug .html to canonical id-slug form', async () => {
    const res = await app.request('/ads/7-something-stale.html');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.html');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/ads/9999.html');
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-numeric id', async () => {
    const res = await app.request('/ads/abc.html');
    expect(res.status).toBe(404);
  });
});

describe('GET /ads/:idSlug.webp', () => {
  it('serves the canonical webp with correct headers', async () => {
    const res = await app.request('/ads/7-three-miles-up.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body: ArrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(FAKE_WEBP);
  });

  it('redirects bare id .webp to canonical', async () => {
    const res = await app.request('/ads/7.webp');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.webp');
  });

  it('redirects wrong-slug .webp to canonical', async () => {
    const res = await app.request('/ads/7-stale.webp');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.webp');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/ads/9999.webp');
    expect(res.status).toBe(404);
  });
});
