import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import type { AttachmentMetadata } from './types.ts';

const FCC_REPORT_BASE: string = 'https://fcc.report';
const ATTACHMENT_HREF_PATTERN: RegExp = /\/IBFS\/[^/]+\/(\d+)$/;

type SectionDef = {
  heading: string;
  firstTh: string;
  source: string;
  descriptionColumn: number;
};

const SECTIONS: SectionDef[] = [
  {
    heading: 'Attachments',
    firstTh: 'Attachment',
    source: 'attachment',
    descriptionColumn: 1,
  },
  {
    heading: 'Files',
    firstTh: 'Description',
    source: 'file',
    descriptionColumn: 2,
  },
];

/**
 * Parse attachment metadata from an fcc.report filing page HTML string.
 * Extracts from both the "Attachments" table (application documents) and
 * the "Files" table (comments, letters, decisions, etc.).
 */
export function parseAttachmentsFromHtml(
  html: string,
  fileNumber: string,
  filingKey: number,
): AttachmentMetadata[] {
  const root: HTMLElement = parse(html);
  const tables: HTMLElement[] = root.querySelectorAll('table.table');
  const attachments: AttachmentMetadata[] = [];

  for (const section of SECTIONS) {
    const table: HTMLElement | undefined = findTableByFirstTh(
      tables,
      section.firstTh,
    );
    if (table == null) {
      continue;
    }

    const rows: HTMLElement[] = table.querySelectorAll('tr');

    // Skip header row (index 0)
    for (let i: number = 1; i < rows.length; i++) {
      const row: HTMLElement = rows[i]!;
      const link: HTMLElement | null = row.querySelector('a');

      if (link == null) {
        continue;
      }

      const href: string = link.getAttribute('href') ?? '';
      const match: RegExpMatchArray | null = href.match(
        ATTACHMENT_HREF_PATTERN,
      );

      if (match == null) {
        continue;
      }

      const attachmentKey: number = Number(match[1]);
      const attachmentName: string = link.text.trim();
      const cells: HTMLElement[] = row.querySelectorAll('td');
      const description: string =
        cells.length > section.descriptionColumn
          ? cells[section.descriptionColumn]!.text.trim()
          : '';

      attachments.push({
        attachmentKey,
        filingKey,
        fileNumber,
        source: section.source,
        attachmentName,
        description,
        downloadUrl: `${FCC_REPORT_BASE}${href}.pdf`,
      });
    }
  }

  return attachments;
}

function findTableByFirstTh(
  tables: HTMLElement[],
  thText: string,
): HTMLElement | undefined {
  for (const table of tables) {
    const firstTh: HTMLElement | null = table.querySelector('th');
    if (firstTh != null && firstTh.text.trim() === thText) {
      return table;
    }
  }
  return undefined;
}
