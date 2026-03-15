import type { FileNumber } from '../lib/file-number.ts';
import { fetchWithRetry } from './fetch-retry.ts';
import { parseAttachmentsFromHtml } from './html-parser.ts';
import type { AttachmentMetadata, DiscoveryProvider } from './types.ts';

const FCC_REPORT_BASE: string = 'https://fcc.report/IBFS';

/**
 * Create a discovery provider that scrapes fcc.report for attachment metadata.
 * File numbers are expected to be in canonical hyphenated format (FileNumber).
 */
export function createFccReportProvider(
  _subsystemCode: string,
  _appTypeCode: string,
): DiscoveryProvider {
  return {
    name: 'fcc-report',
    async discover(
      fileNumber: FileNumber,
      filingKey: number,
    ): Promise<AttachmentMetadata[]> {
      const url: string = `${FCC_REPORT_BASE}/${fileNumber}`;

      const response: Response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${String(response.status)} ${response.statusText}`,
        );
      }

      const html: string = await response.text();
      return parseAttachmentsFromHtml(html, fileNumber, filingKey);
    },
  };
}
