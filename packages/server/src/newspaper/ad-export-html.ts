/**
 * Pure utilities for rendering exportable house-ad HTML pages.
 *
 * No I/O, no DB access. The route layer composes these functions
 * with repository data.
 */

const SLUG_MAX_LENGTH: number = 60;

/**
 * Convert a tagline into a URL-safe kebab-case slug.
 *
 * Rules: NFKD-normalize, strip diacritics, lowercase, replace any run of
 * non-[a-z0-9] with a single hyphen, trim leading/trailing hyphens,
 * truncate to 60 chars at a hyphen boundary.
 */
export function slugify(input: string): string {
  const ascii: string = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase();

  const collapsed: string = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (collapsed.length <= SLUG_MAX_LENGTH) {
    return collapsed;
  }

  const truncated: string = collapsed.slice(0, SLUG_MAX_LENGTH);
  const lastHyphen: number = truncated.lastIndexOf('-');
  if (lastHyphen <= 0) {
    return truncated;
  }
  return truncated.slice(0, lastHyphen);
}

/**
 * Escape the five HTML special characters so an arbitrary string is safe
 * to interpolate into element text or double-quoted attribute values.
 *
 * Order matters: `&` MUST be replaced first to avoid double-escaping
 * the entities introduced by the later replacements.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Append the standard daily-orbit UTM tracking params to a base URL,
 * preserving any path/query already present. Overrides utm_* params
 * on conflict so the canonical campaign attribution always wins.
 */
export function buildAdDestinationUrl(baseUrl: string, adId: number): string {
  const url: URL = new URL(baseUrl);
  url.searchParams.set('utm_source', 'daily_orbit');
  url.searchParams.set('utm_medium', 'house_ad');
  url.searchParams.set('utm_campaign', 'launch');
  url.searchParams.set('utm_content', `ad-${String(adId)}`);
  return url.toString();
}
