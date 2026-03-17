import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTextFromPdf, looksLikeBinary } from './extract-text.ts';

const TEXT_PDF_PATH: string = resolve(
  '../../data/attachments/ARC/ARC-MOD-20030610-00024/319622.pdf',
);
const SCANNED_PDF_PATH: string = resolve(
  '../../data/attachments/IHF/IHF-RWL-20150624-00003/1097976.pdf',
);

const canRun: boolean =
  existsSync(TEXT_PDF_PATH) && existsSync(SCANNED_PDF_PATH);

describe('looksLikeBinary', () => {
  it('returns true for text starting with %PDF- header', () => {
    const pdfHeader: string = '%PDF-1.4 some binary garbage here \x00\x01\x02';
    expect(looksLikeBinary(pdfHeader)).toEqual(true);
  });

  it('returns true when >10% of non-whitespace chars are non-printable', () => {
    // 90 printable chars + 11 non-printable = 101 non-whitespace, ~10.9% non-printable
    const printable: string = 'A'.repeat(90);
    const nonPrintable: string = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0E\x0F';
    expect(looksLikeBinary(printable + nonPrintable)).toEqual(true);
  });

  it('returns false for normal English text', () => {
    const text: string =
      'The Federal Communications Commission today approved the application for a new satellite license.';
    expect(looksLikeBinary(text)).toEqual(false);
  });

  it('returns false for text with markdown formatting and Unicode', () => {
    const text: string =
      '# Heading\n\n**Bold text** with *emphasis* and a link [here](http://example.com).\n\nUnicode: café, naïve, résumé, über, 日本語テスト';
    expect(looksLikeBinary(text)).toEqual(false);
  });

  it('returns false for empty string', () => {
    expect(looksLikeBinary('')).toEqual(false);
  });

  it('returns false at exactly the 10% threshold boundary', () => {
    // 90 printable + 10 non-printable = 100 non-whitespace, exactly 10% non-printable
    const printable: string = 'B'.repeat(90);
    const nonPrintable: string = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0E';
    expect(looksLikeBinary(printable + nonPrintable)).toEqual(false);
  });
});

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
