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
