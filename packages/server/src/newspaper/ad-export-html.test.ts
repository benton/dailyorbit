import { describe, expect, test } from 'vitest';
import { slugify } from './ad-export-html.ts';

describe('slugify', () => {
  test('lowercases ASCII and replaces spaces with hyphens', () => {
    expect(slugify('Three Miles Up')).toBe('three-miles-up');
  });

  test('strips diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  test('removes punctuation and quotes', () => {
    expect(slugify(`"All the Frequencies, Fit to Print!"`)).toBe(
      'all-the-frequencies-fit-to-print',
    );
  });

  test('collapses runs of separators and trims', () => {
    expect(slugify('  hello---world  ')).toBe('hello-world');
  });

  test('truncates to 60 characters at a hyphen boundary', () => {
    const long: string =
      'this is a very long tagline that should be truncated at a hyphen boundary not mid word';
    const result: string = slugify(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/-$/);
    expect(result).not.toMatch(/^-/);
    expect(result.split('-').every((p: string) => p.length > 0)).toBe(true);
  });

  test('is idempotent', () => {
    const once: string = slugify('Three Miles Up & Counting!');
    expect(slugify(once)).toBe(once);
  });

  test('handles all-symbol input by returning empty string', () => {
    expect(slugify('!!!')).toBe('');
  });
});
