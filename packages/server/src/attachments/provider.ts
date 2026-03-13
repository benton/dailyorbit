import { createFccReportProvider } from './fcc-report.ts';
import { fccGovProvider } from './fcc-gov.ts';
import type { DiscoveryProvider } from './types.ts';

/**
 * Factory function to create a discovery provider by name.
 * The fcc-report provider needs subsystem/appType codes per filing,
 * so it returns a new instance for each filing context.
 */
export function createProvider(
  name: 'fcc-report' | 'fcc-gov',
  subsystemCode: string,
  appTypeCode: string,
): DiscoveryProvider {
  switch (name) {
    case 'fcc-report':
      return createFccReportProvider(subsystemCode, appTypeCode);
    case 'fcc-gov':
      return fccGovProvider;
  }
}
