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

export type RenderAdHtmlInput = {
  id: number;
  slug: string;
  tagline: string;
  destinationUrl: string;
  absoluteImageUrl: string;
};

/**
 * Render a complete, self-contained HTML document for one house ad.
 *
 * - All styles inline on elements (survives Outlook/Gmail/Substack).
 * - Single wrapping <a> — entire card is one click target. No nested links.
 * - <img src> is RELATIVE to the HTML file so "Save Page As…" pulls both
 *   into one folder and the reference still resolves.
 * - og:/twitter: meta tags use the absolute image URL for chat previews.
 * - Google Fonts <link> for the newspaper typography; clients that strip
 *   remote stylesheets fall back to Georgia/Courier gracefully.
 * - Faithful port of the in-paper .house-ad look from newspaper.css.
 */
export function renderAdHtml(input: RenderAdHtmlInput): string {
  const tagline: string = escapeHtml(input.tagline);
  const destinationUrl: string = escapeHtml(input.destinationUrl);
  const absoluteImageUrl: string = escapeHtml(input.absoluteImageUrl);
  // The slug is a path component inside <img src>, so URL-encode it (not
  // HTML-escape). For slugs produced by `slugify` this is a no-op, but the
  // input type permits any string and we want correct behavior either way.
  const relativeImageSrc: string = `${String(input.id)}-${encodeURIComponent(input.slug)}.webp`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Daily Orbit — ${tagline}</title>
<meta property="og:title" content="The Daily Orbit">
<meta property="og:description" content="${tagline}">
<meta property="og:image" content="${absoluteImageUrl}">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital@0;1&family=Josefin+Slab:wght@600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:24px;background:#faf7f0;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;color:#1a1a1a">
<a href="${destinationUrl}" style="display:block;max-width:480px;margin:1rem auto;padding:1.25rem 1.5rem;background:#faf7f0;border:3px double #5c4a32;text-align:center;text-decoration:none;color:inherit">
<img src="${relativeImageSrc}" alt="${tagline}" width="320" height="320" style="display:block;max-width:100%;height:auto;margin:0 auto 0.75rem;border:1px solid #b8a88a">
<p style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.15rem;line-height:1.4;color:#5c4a32;margin:0.5rem 0">&ldquo;${tagline}&rdquo;</p>
<p style="font-family:'Josefin Slab','Courier New',serif;font-size:1rem;font-weight:600;color:#1a1a1a;margin:0.75rem 0 0.5rem">Subscribe to <em>The Daily Orbit</em> today!</p>
<p style="font-family:'Josefin Slab','Courier New',serif;font-size:0.7rem;font-variant:small-caps;letter-spacing:0.15em;color:#8b7355;margin:0.75rem 0 0">&#x2550;&#x2550; An Advertisement &#x2550;&#x2550;</p>
</a>
</body>
</html>
`;
}
