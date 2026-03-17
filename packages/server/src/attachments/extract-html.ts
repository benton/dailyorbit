import { parse } from 'node-html-parser';
import type { ExtractionResult } from './extract-text.ts';

const MIN_TEXT_CHARS: number = 50;
const AUTH_ERROR_MAX_BYTES: number = 500;

const AUTH_ERROR_PATTERNS: RegExp[] = [
  /webpage not available/i,
  /auth failed/i,
  /could not resolve host/i,
  /access denied/i,
  /403 forbidden/i,
  /401 unauthorized/i,
];

/**
 * Returns true if the HTML content looks like a failed download stub
 * (tiny file with error text rather than real FCC content).
 */
export function looksLikeAuthError(
  html: string,
  fileSizeBytes: number,
): boolean {
  if (fileSizeBytes > AUTH_ERROR_MAX_BYTES) return false;
  return AUTH_ERROR_PATTERNS.some((pattern: RegExp) => pattern.test(html));
}

/**
 * Extract readable text from an HTML string.
 *
 * Uses node-html-parser to parse the DOM, strips script/style/noscript
 * elements, extracts text content, and collapses whitespace.
 */
export function extractTextFromHtml(html: string): ExtractionResult {
  try {
    const root = parse(html);

    // Remove non-content elements
    for (const selector of ['script', 'style', 'noscript']) {
      for (const el of root.querySelectorAll(selector)) {
        el.remove();
      }
    }

    // Extract text — prefer body if present, else use full root
    const body = root.querySelector('body');
    const text: string = (body ?? root).textContent
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const textLength: number = text.replace(/\s/g, '').length;

    if (textLength < MIN_TEXT_CHARS) {
      return { status: 'skipped_no_text', text, textLength, pageCount: 1 };
    }

    return { status: 'extracted', text, textLength, pageCount: 1 };
  } catch (e: unknown) {
    const error: string = e instanceof Error ? e.message : String(e);
    return { status: 'failed', text: null, textLength: 0, pageCount: 0, error };
  }
}
