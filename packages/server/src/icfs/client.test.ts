import { describe, expect, it } from 'vitest';
import { getFilingDetail, searchFilings } from './client.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';

const LIVE_API: boolean = process.env['ICFS_LIVE_TESTS'] === '1';
const describeIf = LIVE_API ? describe : describe.skip;

describeIf('ICFS client (live API)', () => {
  describe('searchFilings', () => {
    it('returns results with valid file numbers for SAT-LOA-2025', async () => {
      const results: IcfsSearchResult[] = await searchFilings('SAT-LOA-2025');

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.fileNumber).toContain('SAT-LOA-2025');
      }
    });

    it('results all have subsystem SAT', async () => {
      const results: IcfsSearchResult[] = await searchFilings('SAT-LOA-2025');

      for (const r of results) {
        expect(r.subsystem).toEqual('SAT');
      }
    });

    it('returns empty array for nonsense query', async () => {
      const results: IcfsSearchResult[] = await searchFilings(
        'XYZNONEXISTENT99999',
      );
      expect(results).toEqual([]);
    });
  });

  describe('getFilingDetail', () => {
    it('returns found=true with populated summary for known filing', async () => {
      const detail: IcfsFilingDetail = await getFilingDetail(
        'SAT-LOA-20250221-00050',
      );

      expect(detail.found).toEqual(true);
      expect(detail.summary).not.toBeNull();
      expect(detail.summary!.fileNumber).toEqual('SAT-LOA-20250221-00050');
    });

    it('summary has correct applicant name', async () => {
      const detail: IcfsFilingDetail = await getFilingDetail(
        'SAT-LOA-20250221-00050',
      );

      expect(detail.summary!.applicantName).toEqual('ICEYE US, Inc.');
    });

    it('returns found=false for nonexistent filing', async () => {
      const detail: IcfsFilingDetail = await getFilingDetail(
        'NONEXISTENT-00000000-99999',
      );

      expect(detail.found).toEqual(false);
      expect(detail.summary).toBeNull();
    });

    it('returns populated transfer parties for a T/C filing', async () => {
      const detail: IcfsFilingDetail = await getFilingDetail(
        'SAT-T/C-20250917-00287',
      );

      expect(detail.found).toEqual(true);
      expect(detail.transferParties).not.toBeNull();
      expect(detail.transferParties!.transfereeName.length).toBeGreaterThan(0);
      expect(detail.transferParties!.transferorName.length).toBeGreaterThan(0);
    });
  });
});
