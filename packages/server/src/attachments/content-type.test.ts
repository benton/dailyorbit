import { describe, expect, it } from 'vitest';
import { extensionForContentType } from './content-type.ts';

describe('extensionForContentType', () => {
  const knownTypes: Array<{ contentType: string; expected: string }> = [
    { contentType: 'application/pdf', expected: 'pdf' },
    { contentType: 'text/html', expected: 'html' },
    { contentType: 'text/plain', expected: 'txt' },
    { contentType: 'image/jpeg', expected: 'jpg' },
    { contentType: 'image/png', expected: 'png' },
    { contentType: 'application/json', expected: 'json' },
    { contentType: 'application/zip', expected: 'zip' },
    { contentType: 'application/msword', expected: 'doc' },
    { contentType: 'application/octet-stream', expected: 'bin' },
  ];

  it.each(knownTypes)(
    'maps $contentType → $expected',
    ({ contentType, expected }) => {
      expect(extensionForContentType(contentType)).toEqual(expected);
    },
  );

  it('strips parameters before lookup', () => {
    expect(extensionForContentType('text/html; charset=UTF-8')).toEqual('html');
    expect(extensionForContentType('application/pdf; name="file.pdf"')).toEqual(
      'pdf',
    );
  });

  it('is case-insensitive', () => {
    expect(extensionForContentType('Application/PDF')).toEqual('pdf');
    expect(extensionForContentType('TEXT/HTML')).toEqual('html');
  });

  it('returns bin for unknown types', () => {
    expect(extensionForContentType('application/x-unknown-type')).toEqual(
      'bin',
    );
    expect(extensionForContentType('foo/bar')).toEqual('bin');
  });

  it('handles empty string gracefully', () => {
    expect(extensionForContentType('')).toEqual('bin');
  });
});
