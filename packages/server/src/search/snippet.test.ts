import { describe, it, expect } from 'vitest';
import { extractSnippet } from './snippet.ts';

describe('extractSnippet', () => {
  const longText: string =
    'The Federal Communications Commission today released a public notice regarding satellite frequency coordination. ' +
    'The application seeks authority to launch and operate a geostationary satellite in the Ka-band. ' +
    'Adjacent satellite operators have filed comments expressing concerns about potential interference. ' +
    'The technical analysis demonstrates compliance with applicable power flux density limits.';

  it('should return a snippet centered on the first match', () => {
    const result: { snippet: string; matchCount: number } = extractSnippet(
      longText,
      'Ka-band',
      120,
    );
    expect(result.snippet).toContain('<mark>Ka-band</mark>');
    expect(result.matchCount).toEqual(1);
  });

  it('should highlight multiple occurrences of the same term', () => {
    const text: string =
      'satellite operators and satellite systems and satellite networks';
    const result = extractSnippet(text, 'satellite', 200);
    expect(result.snippet.match(/<mark>/g)?.length).toEqual(3);
    expect(result.matchCount).toEqual(3);
  });

  it('should handle multi-word queries by highlighting each term', () => {
    const result = extractSnippet(longText, 'satellite interference', 400);
    expect(result.snippet).toContain('<mark>satellite</mark>');
    expect(result.snippet).toContain('<mark>interference</mark>');
  });

  it('should be case-insensitive', () => {
    const result = extractSnippet(longText, 'SATELLITE', 200);
    expect(result.snippet).toContain('<mark>');
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('should return truncated text with ellipsis when no match is found', () => {
    const result = extractSnippet(longText, 'xyznonexistent', 50);
    expect(result.snippet.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(result.matchCount).toEqual(0);
  });

  it('should return empty snippet for null or empty input', () => {
    expect(extractSnippet(null, 'test', 100).snippet).toEqual('');
    expect(extractSnippet('', 'test', 100).snippet).toEqual('');
  });

  it('should escape HTML in the source text to prevent XSS', () => {
    const xssText: string =
      'Some <script>alert("xss")</script> satellite text';
    const result = extractSnippet(xssText, 'satellite', 200);
    expect(result.snippet).not.toContain('<script>');
    expect(result.snippet).toContain('&lt;script&gt;');
    expect(result.snippet).toContain('<mark>satellite</mark>');
  });
});
