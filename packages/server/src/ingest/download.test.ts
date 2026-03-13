import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_URL, zipPathForExtractDir } from './download.ts';

describe('download constants', () => {
  it('DEFAULT_SOURCE_URL points to FCC FTP IBFS.zip', () => {
    expect(DEFAULT_SOURCE_URL).toEqual(
      'ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip',
    );
    expect(DEFAULT_SOURCE_URL).toMatch(/^ftp:\/\//);
    expect(DEFAULT_SOURCE_URL).toMatch(/IBFS\.zip$/);
  });
});

describe('zipPathForExtractDir', () => {
  const cases: Array<{ extractDir: string; expected: string }> = [
    { extractDir: '/tmp/IBFS', expected: '/tmp/IBFS.zip' },
    { extractDir: '/foo/bar/data', expected: '/foo/bar/data.zip' },
    { extractDir: 'relative/path', expected: 'relative/path.zip' },
  ];

  it.each(cases)(
    'appends .zip to $extractDir',
    ({ extractDir, expected }: { extractDir: string; expected: string }) => {
      expect(zipPathForExtractDir(extractDir)).toEqual(expected);
    },
  );
});
