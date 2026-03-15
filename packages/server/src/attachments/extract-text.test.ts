import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTextFromPdf } from './extract-text.ts';

const TEXT_PDF_PATH: string = resolve(
  '../../data/attachments/ARC/ARC-MOD-20030610-00024/319622.pdf',
);
const SCANNED_PDF_PATH: string = resolve(
  '../../data/attachments/IHF/IHF-RWL-20150624-00003/1097976.pdf',
);

const canRun: boolean =
  existsSync(TEXT_PDF_PATH) && existsSync(SCANNED_PDF_PATH);

describe.skipIf(!canRun)('extractTextFromPdf', () => {
  it('extracts markdown text from a text-based PDF', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF_PATH));
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('extracted');
    if (result.status !== 'extracted') return;
    expect(result.textLength).toBeGreaterThan(100);
    expect(result.text).toContain('FEDERAL COMMUNICATIONS COMMISSION');
    expect(result.pageCount).toBeGreaterThan(0);
  });

  it('detects scanned PDFs and returns skipped status', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(SCANNED_PDF_PATH));
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('skipped_no_text');
    if (result.status === 'failed') return;
    expect(result.textLength).toBeLessThan(50);
  });

  it('returns failed status for invalid PDF bytes', () => {
    const bytes: Uint8Array = new Uint8Array([0, 1, 2, 3]);
    const result = extractTextFromPdf(bytes);
    expect(result.status).toEqual('failed');
    if (result.status !== 'failed') return;
    expect(result.error).toBeDefined();
  });
});
