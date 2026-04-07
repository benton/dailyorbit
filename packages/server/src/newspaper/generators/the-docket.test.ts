import { describe, expect, it } from 'vitest';
import type { RecentFiling } from '../../stats/types.ts';
import {
  aggregateBySubsystem,
  aggregateTopApplicants,
  formatFilingSummaries,
  formatFilingsBySubsystem,
  formatTopApplicants,
} from './the-docket.ts';

function filing(overrides: Partial<RecentFiling>): RecentFiling {
  return {
    file_number: 'SAT-STA-20260406-00001',
    callsign: null,
    address_attention: null,
    subsystem_code: 'SAT',
    app_type_code: 'STA',
    status_code: 'Pending Review',
    date_filed: '2026-04-06',
    company_name: null,
    summary: null,
    ...overrides,
  };
}

describe('aggregateBySubsystem', () => {
  it('counts filings grouped by subsystem_code, sorted descending', () => {
    const rows: RecentFiling[] = [
      filing({ subsystem_code: 'SES' }),
      filing({ subsystem_code: 'SAT' }),
      filing({ subsystem_code: 'SES' }),
      filing({ subsystem_code: 'SES' }),
      filing({ subsystem_code: 'ITC' }),
    ];
    expect(aggregateBySubsystem(rows)).toEqual([
      { subsystemCode: 'SES', count: 3 },
      { subsystemCode: 'SAT', count: 1 },
      { subsystemCode: 'ITC', count: 1 },
    ]);
  });

  it('returns an empty array for no filings', () => {
    expect(aggregateBySubsystem([])).toEqual([]);
  });
});

describe('aggregateTopApplicants', () => {
  it('prefers company_name but falls back to address_attention', () => {
    const rows: RecentFiling[] = [
      filing({ company_name: 'SpaceX', address_attention: 'Space X Holdings' }),
      filing({ company_name: 'SpaceX', address_attention: 'Space X Holdings' }),
      filing({ company_name: null, address_attention: 'Siren Communications' }),
      filing({
        company_name: 'The E.W. Scripps Company',
        address_attention: 'Scripps Broadcasting',
      }),
    ];
    expect(aggregateTopApplicants(rows)).toEqual([
      { companyName: 'SpaceX', filingCount: 2 },
      { companyName: 'Siren Communications', filingCount: 1 },
      { companyName: 'The E.W. Scripps Company', filingCount: 1 },
    ]);
  });

  it('skips rows with no applicant information', () => {
    const rows: RecentFiling[] = [
      filing({ company_name: null, address_attention: null }),
      filing({ company_name: 'Hughes', address_attention: null }),
    ];
    expect(aggregateTopApplicants(rows)).toEqual([
      { companyName: 'Hughes', filingCount: 1 },
    ]);
  });

  it('caps the result at 5 applicants', () => {
    const rows: RecentFiling[] = Array.from(
      { length: 10 },
      (_: unknown, i: number) =>
        filing({
          company_name: `Company ${String(i)}`,
          file_number: `F-${String(i)}`,
        }),
    );
    expect(aggregateTopApplicants(rows)).toHaveLength(5);
  });
});

describe('formatFilingSummaries', () => {
  it('renders a markdown bullet list mirroring the reader table', () => {
    const rows: RecentFiling[] = [
      filing({
        file_number: 'SAT-STA-20260406-00153',
        subsystem_code: 'SAT',
        app_type_code: 'STA',
        company_name: 'SpaceX',
        address_attention: 'Space Exploration Holdings, LLC',
        status_code: 'Pending Review',
      }),
      filing({
        file_number: 'SES-STA-20260403-00848',
        subsystem_code: 'SES',
        app_type_code: 'STA',
        company_name: null,
        address_attention: 'Heighliner Corp',
        status_code: 'Pending Payment',
      }),
    ];
    expect(formatFilingSummaries(rows)).toBe(
      [
        '- SAT-STA-20260406-00153 (SAT-STA) — SpaceX [Pending Review]',
        '- SES-STA-20260403-00848 (SES-STA) — Heighliner Corp [Pending Payment]',
      ].join('\n'),
    );
  });

  it('returns a placeholder string when there are no filings', () => {
    expect(formatFilingSummaries([])).toBe('_No filings recorded._');
  });
});

describe('formatFilingsBySubsystem / formatTopApplicants empty states', () => {
  it('returns the sentinel strings when there is no data', () => {
    expect(formatFilingsBySubsystem([])).toBe('_No filing data available._');
    expect(formatTopApplicants([])).toBe('_No applicant data available._');
  });
});
