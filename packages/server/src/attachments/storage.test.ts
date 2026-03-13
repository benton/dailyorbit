import { describe, expect, it } from 'vitest';
import { attachmentStoragePath } from './storage.ts';

describe('attachmentStoragePath', () => {
  const cases: Array<{
    basePath: string;
    subsystem: string;
    hyphenated: string;
    key: number;
    expected: string;
  }> = [
    {
      basePath: 'data/attachments',
      subsystem: 'SAT',
      hyphenated: 'SAT-STA-20230614-00142',
      key: 22902690,
      expected: 'data/attachments/SAT/SAT-STA-20230614-00142/22902690.pdf',
    },
    {
      basePath: '/tmp/att',
      subsystem: 'SES',
      hyphenated: 'SES-LOA-20240101-00001',
      key: 99999,
      expected: '/tmp/att/SES/SES-LOA-20240101-00001/99999.pdf',
    },
  ];

  it.each(cases)(
    'builds path $expected',
    ({ basePath, subsystem, hyphenated, key, expected }) => {
      const result: string = attachmentStoragePath(
        basePath,
        subsystem,
        hyphenated,
        key,
      );
      expect(result).toEqual(expected);
    },
  );

  it('path components are deterministic — same inputs always produce same output', () => {
    const a: string = attachmentStoragePath(
      'base',
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
    );
    const b: string = attachmentStoragePath(
      'base',
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
    );
    expect(a).toEqual(b);
  });
});
