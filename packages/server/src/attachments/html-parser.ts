import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import type { AttachmentMetadata } from './types.ts';

const FCC_REPORT_BASE: string = 'https://fcc.report';
const ATTACHMENT_HREF_PATTERN: RegExp = /\/IBFS\/[^/]+\/(\d+)$/;

/**
 * Parse attachment metadata from an fcc.report filing page HTML string.
 * Finds the table following the "Attachments" heading and extracts
 * attachment ID, name, description, and download URL from each row.
 */
export function parseAttachmentsFromHtml(
  html: string,
  fileNumber: string,
  filingKey: number,
): AttachmentMetadata[] {
  const root: HTMLElement = parse(html);

  // Find the Attachments heading, then the next table sibling
  const headings: HTMLElement[] = root.querySelectorAll('h3');
  const attachmentsHeading: HTMLElement | undefined = headings.find(
    (h) => h.text.trim() === 'Attachments',
  );

  if (attachmentsHeading == null) {
    return [];
  }

  // The table follows the heading — find the next table element
  const tables: HTMLElement[] = root.querySelectorAll('table.table');
  let attachmentsTable: HTMLElement | undefined;

  for (const table of tables) {
    const firstTh: HTMLElement | null = table.querySelector('th');
    if (firstTh != null && firstTh.text.trim() === 'Attachment') {
      attachmentsTable = table;
      break;
    }
  }

  if (attachmentsTable == null) {
    return [];
  }

  const rows: HTMLElement[] = attachmentsTable.querySelectorAll('tr');
  const attachments: AttachmentMetadata[] = [];

  // Skip header row (index 0)
  for (let i: number = 1; i < rows.length; i++) {
    const row: HTMLElement = rows[i]!;
    const link: HTMLElement | null = row.querySelector('a');

    if (link == null) {
      continue;
    }

    const href: string = link.getAttribute('href') ?? '';
    const match: RegExpMatchArray | null = href.match(ATTACHMENT_HREF_PATTERN);

    if (match == null) {
      continue;
    }

    const attachmentKey: number = Number(match[1]);
    const attachmentName: string = link.text.trim();
    const cells: HTMLElement[] = row.querySelectorAll('td');
    const description: string = cells.length > 1 ? cells[1]!.text.trim() : '';

    attachments.push({
      attachmentKey,
      filingKey,
      fileNumber,
      attachmentName,
      description,
      downloadUrl: `${FCC_REPORT_BASE}${href}`,
    });
  }

  return attachments;
}
