import { describe, expect, test } from 'vitest';
import {
  buildAdDestinationUrl,
  escapeHtml,
  renderAdHtml,
  slugify,
} from './ad-export-html.ts';

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

describe('escapeHtml', () => {
  test('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test('passes plain text through unchanged', () => {
    expect(escapeHtml('Three Miles Up')).toBe('Three Miles Up');
  });

  test('escapes & before introducing new entities (no double-escape)', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('buildAdDestinationUrl', () => {
  test('appends UTM params to a bare base URL', () => {
    const result: string = buildAdDestinationUrl('https://dailyorbit.org/', 7);
    const url: URL = new URL(result);
    expect(url.origin).toBe('https://dailyorbit.org');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('utm_source')).toBe('daily_orbit');
    expect(url.searchParams.get('utm_medium')).toBe('house_ad');
    expect(url.searchParams.get('utm_campaign')).toBe('launch');
    expect(url.searchParams.get('utm_content')).toBe('ad-7');
  });

  test('preserves an existing path', () => {
    const result: string = buildAdDestinationUrl(
      'https://dailyorbit.org/welcome',
      3,
    );
    expect(new URL(result).pathname).toBe('/welcome');
  });

  test('preserves existing query params and overrides on conflict', () => {
    const result: string = buildAdDestinationUrl(
      'https://dailyorbit.org/?ref=foo&utm_source=manual',
      12,
    );
    const url: URL = new URL(result);
    expect(url.searchParams.get('ref')).toBe('foo');
    expect(url.searchParams.get('utm_source')).toBe('daily_orbit');
    expect(url.searchParams.get('utm_content')).toBe('ad-12');
  });

  test('uses numeric id for utm_content even when id is large', () => {
    const result: string = buildAdDestinationUrl(
      'https://dailyorbit.org/',
      999,
    );
    expect(new URL(result).searchParams.get('utm_content')).toBe('ad-999');
  });
});

describe('renderAdHtml', () => {
  const baseInput = {
    id: 7,
    slug: 'three-miles-up',
    tagline: 'Three Miles Up & Counting',
    destinationUrl: 'https://dailyorbit.org/?utm_source=daily_orbit',
    absoluteImageUrl: 'https://dailyorbit.org/ads/7-three-miles-up.webp',
  };

  test('starts with <!doctype html>', () => {
    expect(renderAdHtml(baseInput).startsWith('<!doctype html>')).toBe(true);
  });

  test('uses the relative image src so save-as works', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain('src="7-three-miles-up.webp"');
  });

  test('embeds the tagline (HTML-escaped) in title and visible text', () => {
    const html: string = renderAdHtml({
      ...baseInput,
      tagline: 'Tom & "Jerry"',
    });
    expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
  });

  test('uses the destinationUrl on the wrapping anchor', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain(
      'href="https://dailyorbit.org/?utm_source=daily_orbit"',
    );
  });

  test('uses the absoluteImageUrl in og:image meta tag', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain(
      '<meta property="og:image" content="https://dailyorbit.org/ads/7-three-miles-up.webp">',
    );
  });

  test('contains exactly one anchor element (single click target)', () => {
    const html: string = renderAdHtml(baseInput);
    const anchorCount: number = (html.match(/<a /g) ?? []).length;
    expect(anchorCount).toBe(1);
  });

  test('contains no <script> tags', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).not.toContain('<script');
  });

  test('contains no <style> blocks', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).not.toContain('<style');
  });

  test('URL-encodes the slug in the relative img src', () => {
    const html: string = renderAdHtml({
      ...baseInput,
      slug: 'foo bar&baz',
    });
    expect(html).toContain('src="7-foo%20bar%26baz.webp"');
    // Must NOT appear as HTML-escaped, which would break the file reference
    expect(html).not.toContain('src="7-foo bar&amp;baz.webp"');
  });

  test('snapshot — full output', () => {
    expect(renderAdHtml(baseInput)).toMatchSnapshot();
  });
});
