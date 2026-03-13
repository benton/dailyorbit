import { fetchWithRetry } from './fetch-retry.ts';
import { compactToHyphenated } from './file-number.ts';
import { parseAttachmentsFromHtml } from './html-parser.ts';
import type { AttachmentMetadata, DiscoveryProvider } from './types.ts';

const FCC_REPORT_BASE: string = 'https://fcc.report/IBFS';

/**
 * Create a discovery provider that scrapes fcc.report for attachment metadata.
 * Requires subsystemCode and appTypeCode to convert compact file numbers to
 * the hyphenated format used in URLs.
 */
export function createFccReportProvider(
  subsystemCode: string,
  appTypeCode: string,
): DiscoveryProvider {
  return {
    name: 'fcc-report',
    async discover(
      fileNumber: string,
      filingKey: number,
    ): Promise<AttachmentMetadata[]> {
      const hyphenated: string = compactToHyphenated(
        fileNumber,
        subsystemCode,
        appTypeCode,
      );
      const url: string = `${FCC_REPORT_BASE}/${hyphenated}`;

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
