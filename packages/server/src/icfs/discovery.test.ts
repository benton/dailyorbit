import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryQueries,
  discoverNewFilings,
  generateMonthRange,
} from './discovery.ts';
import type { IcfsSearchResult } from './types.ts';

describe('generateMonthRange', () => {
  it('generates a single month when from equals to', () => {
    expect(generateMonthRange('2025-07', '2025-07')).toEqual(['2025-07']);
  });

  it('generates a range spanning multiple months', () => {
    expect(generateMonthRange('2025-10', '2026-01')).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('handles year boundaries', () => {
    expect(generateMonthRange('2025-12', '2026-02')).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('buildDiscoveryQueries', () => {
  it('generates queries for multiple subsystems, app types, and months', () => {
    const queries: string[] = buildDiscoveryQueries(
      ['SAT'],
      ['LOA', 'MOD'],
      '2025-07',
      '2025-09',
    );

    expect(queries).toEqual([
      'SAT-LOA-202507',
      'SAT-LOA-202508',
      'SAT-LOA-202509',
      'SAT-MOD-202507',
      'SAT-MOD-202508',
      'SAT-MOD-202509',
    ]);
  });

  it('generates queries for multiple subsystems with a single month', () => {
    const queries: string[] = buildDiscoveryQueries(
      ['SAT', 'SES'],
      ['LOA'],
      '2026-01',
      '2026-01',
    );

    expect(queries).toEqual(['SAT-LOA-202601', 'SES-LOA-202601']);
  });
});

const LIVE_API: boolean = process.env['ICFS_LIVE_TESTS'] === '1';
const describeIf = LIVE_API ? describe : describe.skip;

describeIf('discoverNewFilings (live API)', () => {
  it('discovers file numbers for a narrow date range', async () => {
    const queries: string[] = buildDiscoveryQueries(
      ['SAT'],
      ['LOA'],
      '2025-02',
      '2025-02',
    );
    const results: IcfsSearchResult[] = await discoverNewFilings(queries);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.fileNumber).toContain('SAT-LOA-202502');
    }
  });

  it('returns deduplicated results', async () => {
    const queries: string[] = buildDiscoveryQueries(
      ['SAT'],
      ['LOA'],
      '2025-02',
      '2025-02',
    );
    const results: IcfsSearchResult[] = await discoverNewFilings(queries);

    const fileNumbers: string[] = results.map((r) => r.fileNumber);
    const unique: Set<string> = new Set(fileNumbers);
    expect(fileNumbers.length).toEqual(unique.size);
  });
});
