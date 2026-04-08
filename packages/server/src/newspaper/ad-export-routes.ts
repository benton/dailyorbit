import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import {
  buildAdDestinationUrl,
  renderAdHtml,
  slugify,
} from './ad-export-html.ts';

/**
 * Resolved absolute path of the directory house-ad images live in.
 * Used to confine the file-serving route — `record.imagePath` comes from
 * the DB but we still defend against accidental corruption or future code
 * paths that might allow tainted writes.
 */
const HOUSE_ADS_IMAGE_ROOT: string = resolve(
  'data',
  'newspaper',
  'images',
  'library',
  'house-ads',
);

/**
 * Minimal data shape the routes need from the repository.
 * Kept narrow so route tests can stub it without importing DuckDB.
 */
export type AdExportRecord = {
  id: number;
  tagline: string;
  imagePath: string;
};

export type AdExportDeps = {
  /** Look up a single ad by numeric id, or null if not found. */
  lookupAd(id: number): Promise<AdExportRecord | null>;
  /** Return the configured base destination URL for the click target. */
  getDestinationBaseUrl(): string;
  /**
   * Return the public-facing app base URL (e.g. `https://dailyorbit.org`).
   * Used to build the absolute `og:image` URL so the value is independent
   * of which host the request happens to arrive on (CloudFront proxies the
   * request through with `Host: api.dailyorbit.org`, but we want the og
   * tags to reference the canonical apex domain).
   */
  getAppBaseUrl(): string;
};

/**
 * Parse the `:idSlug` route param into `{ id, slug }`. The slug part
 * is optional — `7` is allowed and resolves to `{ id: 7, slug: '' }`.
 *
 * Returns null if the id portion is not a positive integer.
 */
function parseIdSlug(idSlug: string): { id: number; slug: string } | null {
  const dash: number = idSlug.indexOf('-');
  const idStr: string = dash === -1 ? idSlug : idSlug.slice(0, dash);
  const slug: string = dash === -1 ? '' : idSlug.slice(dash + 1);
  if (!/^\d+$/.test(idStr)) return null;
  const id: number = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, slug };
}

function canonicalSlugFor(record: AdExportRecord): string {
  return slugify(record.tagline);
}

function absoluteImageUrl(
  appBaseUrl: string,
  id: number,
  slug: string,
): string {
  // Pinned to the configured public app base URL — never the inbound
  // request URL — so og:image always references the apex domain even
  // when the request is proxied through a different host (CloudFront).
  const origin: string = new URL(appBaseUrl).origin;
  return `${origin}/ads/${String(id)}-${slug}.webp`;
}

export function createAdExportRoutes(deps: AdExportDeps): Hono {
  const routes = new Hono();

  routes.get('/:idSlug{[^/]+\\.html}', async (c) => {
    const param: string = c.req.param('idSlug').replace(/\.html$/, '');
    const parsed = parseIdSlug(param);
    if (parsed == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const record = await deps.lookupAd(parsed.id);
    if (record == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const canonical: string = canonicalSlugFor(record);
    if (parsed.slug !== canonical) {
      return c.redirect(`/ads/${String(record.id)}-${canonical}.html`, 302);
    }

    const html: string = renderAdHtml({
      id: record.id,
      slug: canonical,
      tagline: record.tagline,
      destinationUrl: buildAdDestinationUrl(
        deps.getDestinationBaseUrl(),
        record.id,
      ),
      absoluteImageUrl: absoluteImageUrl(
        deps.getAppBaseUrl(),
        record.id,
        canonical,
      ),
    });

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  routes.get('/:idSlug{[^/]+\\.webp}', async (c) => {
    const param: string = c.req.param('idSlug').replace(/\.webp$/, '');
    const parsed = parseIdSlug(param);
    if (parsed == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const record = await deps.lookupAd(parsed.id);
    if (record == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const canonical: string = canonicalSlugFor(record);
    if (parsed.slug !== canonical) {
      return c.redirect(`/ads/${String(record.id)}-${canonical}.webp`, 302);
    }

    // Try the local filesystem first. In dev (and on whichever instance
    // generated the library), the bytes are right there and we can serve
    // them inline — that preserves "Save Page As…" semantics where the
    // saved HTML and saved .webp end up in one folder.
    //
    // Defense in depth: confine the local read to the house-ads directory
    // even though imagePath is sourced from the DB, never user input.
    const resolvedImagePath: string = resolve(record.imagePath);
    if (resolvedImagePath.startsWith(HOUSE_ADS_IMAGE_ROOT)) {
      try {
        const info = await stat(resolvedImagePath);
        if (info.isFile()) {
          const data: Buffer = await readFile(resolvedImagePath);
          return new Response(data, {
            status: 200,
            headers: {
              'Content-Type': 'image/webp',
              'Content-Length': String(data.length),
              'Cache-Control': 'public, max-age=86400',
            },
          });
        }
      } catch {
        // Fall through to the CDN redirect below.
      }
    }

    // Fall back to the canonical CDN-served path. The bytes live in S3,
    // uploaded by the generator, and a fresh EC2 instance won't have a
    // local copy on its EBS snapshot. Redirecting keeps the route correct
    // on every instance without dragging an S3 client into the request
    // path.
    const filename: string = record.imagePath.split('/').pop() ?? '';
    const cdnUrl: string = `${new URL(deps.getAppBaseUrl()).origin}/newspaper/images/library/house-ads/${filename}`;
    return c.redirect(cdnUrl, 302);
  });

  return routes;
}
