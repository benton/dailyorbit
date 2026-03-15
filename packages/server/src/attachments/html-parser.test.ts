import { describe, expect, it } from 'vitest';
import type { FileNumber } from '../lib/file-number.ts';
import { parseAttachmentsFromHtml } from './html-parser.ts';
import type { AttachmentMetadata } from './types.ts';

const ATTACHMENTS_HTML: string = `
<h3>Attachments</h3>
<table class="table">
  <tr><th>Attachment</th><th>Type</th><th>Date</th></tr>
  <tr>
    <td><a href="/IBFS/SAT-STA-20230614-00142/22902690">Attachment Narrative </a></td>
    <td></td><td></td>
  </tr>
  <tr>
    <td><a href="/IBFS/SAT-STA-20230614-00142/22902694">Attachment Application </a></td>
    <td></td><td></td>
  </tr>
  <tr>
    <td><a href="/IBFS/SAT-STA-20230614-00142/22902695">Attachment HTML </a></td>
    <td>PDF</td><td>2023-06-14</td>
  </tr>
</table>`;

const FILES_HTML: string = `
<h3>Files</h3>
<table class="table">
  <tr><th>Description</th><th>Commentor</th><th>Type / Date</th></tr>
  <tr>
    <td><a href="/IBFS/SAT-LOA-20200526-00055/14552447" class="btn btn-info">Viasat Ex Parte on Kuiper</a></td>
    <td>Viasat, Inc.</td>
    <td>LETTER<br>2022-01-13</td>
  </tr>
  <tr>
    <td><a href="/IBFS/SAT-LOA-20200526-00055/14553085" class="btn btn-info">Grant Request For Extension</a></td>
    <td>Satellite Division, International Bureau</td>
    <td>DECISION<br>2022-01-13</td>
  </tr>
</table>`;

const COMBINED_HTML: string = `${ATTACHMENTS_HTML}\n${FILES_HTML}`;

const FILE_NUMBER: FileNumber = 'SAT-STA-20230614-00142' as FileNumber;
const FILING_KEY: number = 12345;

describe('parseAttachmentsFromHtml', () => {
  it('extracts attachments from the Attachments table', () => {
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      ATTACHMENTS_HTML,
      FILE_NUMBER,
      FILING_KEY,
    );

    expect(result).toEqual([
      {
        attachmentKey: 22902690,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        source: 'attachment',
        attachmentName: 'Attachment Narrative',
        description: '',
        downloadUrl:
          'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf',
      },
      {
        attachmentKey: 22902694,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        source: 'attachment',
        attachmentName: 'Attachment Application',
        description: '',
        downloadUrl:
          'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902694.pdf',
      },
      {
        attachmentKey: 22902695,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        source: 'attachment',
        attachmentName: 'Attachment HTML',
        description: 'PDF',
        downloadUrl:
          'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902695.pdf',
      },
    ]);
  });

  it('extracts files from the Files table with description from Type column', () => {
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      FILES_HTML,
      'SAT-LOA-20200526-00055' as FileNumber,
      99,
    );

    expect(result).toEqual([
      {
        attachmentKey: 14552447,
        filingKey: 99,
        fileNumber: 'SAT-LOA-20200526-00055',
        source: 'file',
        attachmentName: 'Viasat Ex Parte on Kuiper',
        description: 'LETTER\n2022-01-13',
        downloadUrl:
          'https://fcc.report/IBFS/SAT-LOA-20200526-00055/14552447.pdf',
      },
      {
        attachmentKey: 14553085,
        filingKey: 99,
        fileNumber: 'SAT-LOA-20200526-00055',
        source: 'file',
        attachmentName: 'Grant Request For Extension',
        description: 'DECISION\n2022-01-13',
        downloadUrl:
          'https://fcc.report/IBFS/SAT-LOA-20200526-00055/14553085.pdf',
      },
    ]);
  });

  it('extracts from both tables when both are present', () => {
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      COMBINED_HTML,
      FILE_NUMBER,
      FILING_KEY,
    );

    const sources: string[] = result.map((r) => r.source);
    expect(sources.filter((s) => s === 'attachment')).toHaveLength(3);
    expect(sources.filter((s) => s === 'file')).toHaveLength(2);
    expect(result).toHaveLength(5);
  });

  it('returns empty array when no tables exist', () => {
    const html: string = '<html><body><p>No attachments here</p></body></html>';
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      html,
      FILE_NUMBER,
      FILING_KEY,
    );
    expect(result).toEqual([]);
  });

  it('returns empty array for empty attachments table', () => {
    const html: string = `
      <h3>Attachments</h3>
      <table class="table">
        <tr><th>Attachment</th><th>Type</th><th>Date</th></tr>
      </table>`;
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      html,
      FILE_NUMBER,
      FILING_KEY,
    );
    expect(result).toEqual([]);
  });

  it('skips rows without valid attachment links', () => {
    const html: string = `
      <h3>Attachments</h3>
      <table class="table">
        <tr><th>Attachment</th><th>Type</th><th>Date</th></tr>
        <tr><td>No link here</td><td></td><td></td></tr>
        <tr>
          <td><a href="/IBFS/SAT-STA-20230614-00142/22902690">Valid</a></td>
          <td></td><td></td>
        </tr>
      </table>`;
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      html,
      FILE_NUMBER,
      FILING_KEY,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.attachmentKey).toEqual(22902690);
  });
});
