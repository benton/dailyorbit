/** Escape HTML special characters to prevent XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extract a snippet from `text` centered around the first occurrence of any
 * search term, with all occurrences wrapped in <mark> tags.
 *
 * Security: Source text is HTML-escaped before highlight markup is inserted,
 * so only our <mark> tags appear in the output. The frontend should still
 * render via DOMPurify as defense-in-depth.
 *
 * @param text - Source text (may be null)
 * @param query - Space-separated search terms
 * @param maxLength - Maximum character length of the returned snippet (before markup)
 * @returns snippet with <mark> highlights and a count of matches
 */
export function extractSnippet(
  text: string | null | undefined,
  query: string,
  maxLength: number = 150,
): { snippet: string; matchCount: number } {
  if (text == null || text === '') {
    return { snippet: '', matchCount: 0 };
  }

  const terms: string[] = query
    .split(/\s+/)
    .filter((t: string) => t.length > 0)
    .map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) {
    return {
      snippet:
        escapeHtml(text.slice(0, maxLength)) +
        (text.length > maxLength ? '...' : ''),
      matchCount: 0,
    };
  }

  // Use non-global regex to find first match position (g flag omits index)
  const firstMatchPattern: RegExp = new RegExp(
    `(${terms.join('|')})`,
    'i',
  );
  const firstMatch: RegExpMatchArray | null = text.match(firstMatchPattern);
  let start: number = 0;
  if (firstMatch?.index != null) {
    start = Math.max(0, firstMatch.index - Math.floor(maxLength / 3));
  }
  const end: number = Math.min(text.length, start + maxLength);

  let slice: string = text.slice(start, end);
  const prefix: string = start > 0 ? '...' : '';
  const suffix: string = end < text.length ? '...' : '';

  // Escape HTML first, then apply highlights
  slice = escapeHtml(slice);
  let matchCount: number = 0;
  const escapedTerms: string[] = terms.map((t: string) =>
    escapeHtml(t.replace(/\\(.)/g, '$1')),
  );
  const highlightPattern: RegExp = new RegExp(
    `(${escapedTerms.join('|')})`,
    'gi',
  );
  slice = slice.replace(highlightPattern, (_match: string) => {
    matchCount++;
    return `<mark>${_match}</mark>`;
  });

  return { snippet: prefix + slice + suffix, matchCount };
}
