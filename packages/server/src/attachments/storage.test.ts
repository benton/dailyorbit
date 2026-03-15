import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachmentStoragePath,
  findExistingAttachment,
  normalizeDownloadUrl,
} from './storage.ts';

describe('attachmentStoragePath', () => {
  const cases: Array<{
    basePath: string;
    subsystem: string;
    hyphenated: string;
    key: number;
    extension: string;
    expected: string;
  }> = [
    {
      basePath: 'data/attachments',
      subsystem: 'SAT',
      hyphenated: 'SAT-STA-20230614-00142',
      key: 22902690,
      extension: 'pdf',
      expected: 'data/attachments/SAT/SAT-STA-20230614-00142/22902690.pdf',
    },
    {
      basePath: '/tmp/att',
      subsystem: 'SES',
      hyphenated: 'SES-LOA-20240101-00001',
      key: 99999,
      extension: 'html',
      expected: '/tmp/att/SES/SES-LOA-20240101-00001/99999.html',
    },
    {
      basePath: 'data/attachments',
      subsystem: 'SAT',
      hyphenated: 'SAT-LOA-20200101-00001',
      key: 123,
      extension: 'bin',
      expected: 'data/attachments/SAT/SAT-LOA-20200101-00001/123.bin',
    },
  ];

  it.each(cases)(
    'builds path $expected',
    ({ basePath, subsystem, hyphenated, key, extension, expected }) => {
      const result: string = attachmentStoragePath(
        basePath,
        subsystem,
        hyphenated,
        key,
        extension,
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
      'pdf',
    );
    const b: string = attachmentStoragePath(
      'base',
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

describe('findExistingAttachment', () => {
  it('returns path and size when file exists on disk', async () => {
    const tmpDir: string = mkdtempSync(join(tmpdir(), 'att-find-'));
    const dir: string = join(tmpDir, 'SAT', 'SAT-STA-20230614-00142');
    await mkdir(dir, { recursive: true });
    const content: string = 'fake pdf content here';
    await writeFile(join(dir, '12345.pdf'), content);

    const result = await findExistingAttachment(
      tmpDir,
      'SAT',
      'SAT-STA-20230614-00142',
      12345,
    );

    expect(result).not.toBeNull();
    expect(result!.path).toEqual(join(dir, '12345.pdf'));
    expect(result!.fileSizeBytes).toEqual(Buffer.byteLength(content));
  });

  it('returns null when no file exists for the attachment key', async () => {
    const tmpDir: string = mkdtempSync(join(tmpdir(), 'att-find-'));
    const dir: string = join(tmpDir, 'SAT', 'SAT-STA-20230614-00142');
    await mkdir(dir, { recursive: true });

    const result = await findExistingAttachment(
      tmpDir,
      'SAT',
      'SAT-STA-20230614-00142',
      99999,
    );

    expect(result).toBeNull();
  });

  it('returns null when the directory does not exist', async () => {
    const tmpDir: string = mkdtempSync(join(tmpdir(), 'att-find-'));

    const result = await findExistingAttachment(
      tmpDir,
      'SAT',
      'SAT-NONEXISTENT-00000',
      12345,
    );

    expect(result).toBeNull();
  });

  it('finds file regardless of extension', async () => {
    const tmpDir: string = mkdtempSync(join(tmpdir(), 'att-find-'));
    const dir: string = join(tmpDir, 'SES', 'SES-LOA-20240101-00001');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '42.html'), '<html>test</html>');

    const result = await findExistingAttachment(
      tmpDir,
      'SES',
      'SES-LOA-20240101-00001',
      42,
    );

    expect(result).not.toBeNull();
    expect(result!.path).toContain('42.html');
  });
});
