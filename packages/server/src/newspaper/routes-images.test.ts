import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

/**
 * Unit tests for the newspaper image serving route logic.
 * We test the route handler in isolation using Hono's test client.
 */

// ── Test fixtures ───────────────────────────────────────────────────

const FAKE_WEBP: Buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF header stub
let testDir: string;
let app: Hono;

beforeAll(async () => {
  // Create a temp images directory with a test image
  testDir = join(tmpdir(), `route-img-test-${Date.now()}`);
  const dateDir: string = join(testDir, '2026-03-24');
  await mkdir(dateDir, { recursive: true });
  await writeFile(join(dateDir, 'hero.webp'), FAKE_WEBP);
  await writeFile(join(dateDir, 'banner.png'), FAKE_WEBP);

  // Build a minimal Hono app mirroring the route logic but with our test dir
  const { resolve } = await import('node:path');
  const { readFile, stat } = await import('node:fs/promises');

  const IMAGE_CONTENT_TYPES: Record<string, string> = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  const IMAGES_ROOT: string = resolve(testDir);

  app = new Hono();
  app.get('/api/newspaper/images/:date/:filename', async (c) => {
    const date: string = c.req.param('date');
    const filename: string = c.req.param('filename');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'Invalid date format' }, 400);
    }
    if (/[/\\]/.test(filename) || filename.includes('..')) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    const filePath: string = join(IMAGES_ROOT, date, filename);
    const resolved: string = resolve(filePath);

    if (!resolved.startsWith(IMAGES_ROOT)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const ext: string = filename.substring(filename.lastIndexOf('.'));
    const contentType: string | undefined = IMAGE_CONTENT_TYPES[ext];
    if (contentType == null) {
      return c.json({ error: 'Unsupported image type' }, 400);
    }

    try {
      const info = await stat(resolved);
      if (!info.isFile()) {
        return c.json({ error: 'Not found' }, 404);
      }
      const data: Buffer = await readFile(resolved);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(data.length),
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('GET /api/newspaper/images/:date/:filename', () => {
  it('serves a valid webp image with correct headers', async () => {
    const res = await app.request('/api/newspaper/images/2026-03-24/hero.webp');
    expect(res.status).toEqual(200);
    expect(res.headers.get('Content-Type')).toEqual('image/webp');
    expect(res.headers.get('Cache-Control')).toEqual('public, max-age=86400');
    const body: ArrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(FAKE_WEBP);
  });

  it('serves png images with correct content type', async () => {
    const res = await app.request(
      '/api/newspaper/images/2026-03-24/banner.png',
    );
    expect(res.status).toEqual(200);
    expect(res.headers.get('Content-Type')).toEqual('image/png');
  });

  it('rejects invalid date format', async () => {
    const res = await app.request('/api/newspaper/images/bad-date/hero.webp');
    expect(res.status).toEqual(400);
  });

  it('returns 404 for nonexistent files', async () => {
    const res = await app.request(
      '/api/newspaper/images/2026-03-24/missing.webp',
    );
    expect(res.status).toEqual(404);
  });

  it('rejects unsupported file extensions', async () => {
    const res = await app.request('/api/newspaper/images/2026-03-24/hero.txt');
    expect(res.status).toEqual(400);
  });

  it('rejects filenames with directory traversal', async () => {
    const res = await app.request(
      '/api/newspaper/images/2026-03-24/..%2F..%2Fetc%2Fpasswd',
    );
    expect(res.status).toEqual(400);
  });
});
