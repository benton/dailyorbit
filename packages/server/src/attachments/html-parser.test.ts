import { describe, expect, it } from 'vitest';
import { parseAttachmentsFromHtml } from './html-parser.ts';
import type { AttachmentMetadata } from './types.ts';

const SAMPLE_HTML: string = `
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

const FILE_NUMBER: string = 'SATSTA2023061400142';
const FILING_KEY: number = 12345;

describe('parseAttachmentsFromHtml', () => {
  it('extracts all attachments from a well-formed page', () => {
    const result: AttachmentMetadata[] = parseAttachmentsFromHtml(
      SAMPLE_HTML,
      FILE_NUMBER,
      FILING_KEY,
    );

    expect(result).toEqual([
      {
        attachmentKey: 22902690,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        attachmentName: 'Attachment Narrative',
        description: '',
        downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690',
      },
      {
        attachmentKey: 22902694,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        attachmentName: 'Attachment Application',
        description: '',
        downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902694',
      },
      {
        attachmentKey: 22902695,
        filingKey: FILING_KEY,
        fileNumber: FILE_NUMBER,
        attachmentName: 'Attachment HTML',
        description: 'PDF',
        downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902695',
      },
    ]);
  });

  it('returns empty array when no attachments table exists', () => {
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
