import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectContentType } from './validate-content-type.ts';

describe('detectContentType', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'validate-ct-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects a real PDF file as application/pdf', async () => {
    const pdfPath: string = join(tempDir, 'real.pdf');
    // Minimal valid PDF
    writeFileSync(
      pdfPath,
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );

    const result = await detectContentType(pdfPath, 'application/pdf');
    expect(result.mimeType).toEqual('application/pdf');
    expect(result.isDifferent).toEqual(false);
    expect(result.declaredType).toEqual('application/pdf');
  });

  it('detects an ASCII text file as text/plain', async () => {
    const textPath: string = join(tempDir, 'stub.pdf');
    writeFileSync(
      textPath,
      'This filing is no longer available for download.\n',
    );

    const result = await detectContentType(textPath, 'application/pdf');
    expect(result.mimeType).toEqual('text/plain');
    expect(result.isDifferent).toEqual(true);
    expect(result.declaredType).toEqual('application/pdf');
  });

  it('detects a non-PDF binary file as different from application/pdf', async () => {
    const binPath: string = join(tempDir, 'archive.pdf');
    // Zip magic bytes: PK\x03\x04 — `file` may report application/zip or application/octet-stream
    const zipHeader: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    writeFileSync(binPath, zipHeader);

    const result = await detectContentType(binPath, 'application/pdf');
    expect(result.mimeType).not.toEqual('application/pdf');
    expect(result.isDifferent).toEqual(true);
  });

  it('handles null declared type — isDifferent is false', async () => {
    const textPath: string = join(tempDir, 'null-ct.txt');
    writeFileSync(textPath, 'Some text content\n');

    const result = await detectContentType(textPath, null);
    expect(result.mimeType).toEqual('text/plain');
    expect(result.isDifferent).toEqual(false);
    expect(result.declaredType).toBeNull();
  });
});
