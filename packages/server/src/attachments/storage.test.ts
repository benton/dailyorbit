import { describe, expect, it } from 'vitest';
import { attachmentStorageKey, normalizeDownloadUrl } from './storage.ts';

describe('attachmentStorageKey', () => {
  const cases: Array<{
    subsystem: string;
    hyphenated: string;
    key: number;
    extension: string;
    expected: string;
  }> = [
    {
      subsystem: 'SAT',
      hyphenated: 'SAT-STA-20230614-00142',
      key: 22902690,
      extension: 'pdf',
      expected: 'SAT/SAT-STA-20230614-00142/22902690.pdf',
    },
    {
      subsystem: 'SES',
      hyphenated: 'SES-LOA-20240101-00001',
      key: 99999,
      extension: 'html',
      expected: 'SES/SES-LOA-20240101-00001/99999.html',
    },
    {
      subsystem: 'SAT',
      hyphenated: 'SAT-LOA-20200101-00001',
      key: 123,
      extension: 'bin',
      expected: 'SAT/SAT-LOA-20200101-00001/123.bin',
    },
  ];

  it.each(cases)(
    'builds key $expected',
    ({ subsystem, hyphenated, key, extension, expected }) => {
      const result: string = attachmentStorageKey(
        subsystem,
        hyphenated,
        key,
        extension,
      );
      expect(result).toEqual(expected);
    },
  );

  it('key components are deterministic — same inputs always produce same output', () => {
    const a: string = attachmentStorageKey(
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
      'pdf',
    );
    const b: string = attachmentStorageKey(
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
      'pdf',
    );
    expect(a).toEqual(b);
  });
});

describe('normalizeDownloadUrl', () => {
  it('appends .pdf to URLs without it', () => {
    expect(
      normalizeDownloadUrl(
        'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690',
      ),
    ).toEqual('https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf');
  });

  it('leaves URLs that already end in .pdf unchanged', () => {
    const url: string =
      'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf';
    expect(normalizeDownloadUrl(url)).toEqual(url);
  });
});
