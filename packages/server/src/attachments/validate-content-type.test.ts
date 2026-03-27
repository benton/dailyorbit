import { describe, expect, it } from 'vitest';
import { detectContentType } from './validate-content-type.ts';

describe('detectContentType', () => {
  it('detects PDF magic bytes as application/pdf', async () => {
    const pdfBuf: Buffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );

    const result = await detectContentType(pdfBuf, 'application/pdf');
    expect(result.mimeType).toEqual('application/pdf');
    expect(result.isDifferent).toEqual(false);
    expect(result.declaredType).toEqual('application/pdf');
  });

  it('detects ZIP magic bytes as different from application/pdf', async () => {
    const zipBuf: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    const result = await detectContentType(zipBuf, 'application/pdf');
    expect(result.mimeType).toEqual('application/zip');
    expect(result.isDifferent).toEqual(true);
  });

  it('falls back to declared type for plain text (no magic bytes)', async () => {
    const textBuf: Buffer = Buffer.from('This is just plain text content.\n');

    const result = await detectContentType(textBuf, 'text/plain');
    expect(result.mimeType).toEqual('text/plain');
    expect(result.isDifferent).toEqual(false);
    expect(result.declaredType).toEqual('text/plain');
  });

  it('falls back to application/octet-stream when both detection and declared are null', async () => {
    const textBuf: Buffer = Buffer.from('Some text content\n');

    const result = await detectContentType(textBuf, null);
    expect(result.mimeType).toEqual('application/octet-stream');
    expect(result.isDifferent).toEqual(false);
    expect(result.declaredType).toBeNull();
  });

  it('reports isDifferent when file-type detects differently from declared', async () => {
    // ZIP bytes but declared as PDF
    const zipBuf: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    const result = await detectContentType(zipBuf, 'application/pdf');
    expect(result.isDifferent).toEqual(true);
    expect(result.declaredType).toEqual('application/pdf');
  });

  it('detects PNG magic bytes', async () => {
    // PNG header: 89 50 4E 47 0D 0A 1A 0A
    const pngBuf: Buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);

    const result = await detectContentType(pngBuf, 'image/png');
    expect(result.mimeType).toEqual('image/png');
    expect(result.isDifferent).toEqual(false);
  });

  it('handles empty buffer by falling back to declared type', async () => {
    const emptyBuf: Buffer = Buffer.alloc(0);

    const result = await detectContentType(emptyBuf, 'application/pdf');
    expect(result.mimeType).toEqual('application/pdf');
    expect(result.isDifferent).toEqual(false);
  });

  it('handles empty buffer with null declared type', async () => {
    const emptyBuf: Buffer = Buffer.alloc(0);

    const result = await detectContentType(emptyBuf, null);
    expect(result.mimeType).toEqual('application/octet-stream');
    expect(result.isDifferent).toEqual(false);
  });

  it('isDifferent is false when declared type is null and detection succeeds', async () => {
    // ZIP bytes, no declared type
    const zipBuf: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    const result = await detectContentType(zipBuf, null);
    expect(result.mimeType).toEqual('application/zip');
    // declaredType is null → isDifferent should be false (null != null is false)
    expect(result.isDifferent).toEqual(false);
  });
});
