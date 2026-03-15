import { describe, expect, it } from 'vitest';
import { normalizeFileNumber } from './file-number.ts';
import type { NormalizeResult } from './file-number.ts';

describe('normalizeFileNumber', () => {
  describe('already-hyphenated file numbers', () => {
    const cases: Array<[string, string]> = [
      ['SES-LIC-19860303-00312', 'SES-LIC-19860303-00312'],
      ['SAT-LOA-20250221-00050', 'SAT-LOA-20250221-00050'],
      ['ITC-214-19900202-00021', 'ITC-214-19900202-00021'],
      ['SES-T/C-20100315-00482', 'SES-T/C-20100315-00482'],
      ['SAT-A/O-19970815-00042', 'SAT-A/O-19970815-00042'],
      ['IHF-C/P-19890420-00003', 'IHF-C/P-19890420-00003'],
    ];

    it.each(cases)(
      'passes through %s unchanged',
      (input: string, expected: string) => {
        const result: NormalizeResult = normalizeFileNumber(input);
        expect(result).toEqual({ ok: true, fileNumber: expected });
      },
    );
  });

  describe('unhyphenated file numbers from XML bulk import', () => {
    const cases: Array<[string, string]> = [
      ['SESLIC1986030300312', 'SES-LIC-19860303-00312'],
      ['SATLOA2025022100050', 'SAT-LOA-20250221-00050'],
      ['ARCMOD1998010800002', 'ARC-MOD-19980108-00002'],
      ['SESREG2018100100001', 'SES-REG-20181001-00001'],
      ['FCNNEW2005061500042', 'FCN-NEW-20050615-00042'],
      ['SCLMOD2010030100015', 'SCL-MOD-20100301-00015'],
      ['SPCNEW2002050100042', 'SPC-NEW-20020501-00042'],
      ['325NEW2001030100005', '325-NEW-20010301-00005'],
      ['SATAPL2025041100100', 'SAT-APL-20250411-00100'],
      ['SESOTHINTR200100940', 'SES-OTH-INTR2001-00940'],
    ];

    it.each(cases)('normalizes %s to %s', (input: string, expected: string) => {
      const result: NormalizeResult = normalizeFileNumber(input);
      expect(result).toEqual({ ok: true, fileNumber: expected });
    });
  });

  describe('unhyphenated file numbers with slash app types', () => {
    const cases: Array<[string, string]> = [
      ['SEST/C1960010100001', 'SES-T/C-19600101-00001'],
      ['SATA/O1997081500042', 'SAT-A/O-19970815-00042'],
      ['IHFC/P1989042000003', 'IHF-C/P-19890420-00003'],
      ['SATL/A2020050100010', 'SAT-L/A-20200501-00010'],
    ];

    it.each(cases)(
      'normalizes %s with slash app type to %s',
      (input: string, expected: string) => {
        const result: NormalizeResult = normalizeFileNumber(input);
        expect(result).toEqual({ ok: true, fileNumber: expected });
      },
    );
  });

  describe('interim (INTR) file numbers', () => {
    const cases: Array<[string, string]> = [
      ['SPCNEWINTR200200136', 'SPC-NEW-INTR2002-00136'],
      ['SESRWLINTR199900197', 'SES-RWL-INTR1999-00197'],
      ['SEST/CINTR199900485', 'SES-T/C-INTR1999-00485'],
      ['DNCNEWINTR200902077', 'DNC-NEW-INTR2009-02077'],
    ];

    it.each(cases)(
      'normalizes interim %s to %s',
      (input: string, expected: string) => {
        const result: NormalizeResult = normalizeFileNumber(input);
        expect(result).toEqual({ ok: true, fileNumber: expected });
      },
    );
  });

  describe('already-hyphenated interim file numbers', () => {
    it('passes through hyphenated INTR format', () => {
      const result: NormalizeResult = normalizeFileNumber(
        'SPC-NEW-INTR2002-00136',
      );
      expect(result).toEqual({
        ok: true,
        fileNumber: 'SPC-NEW-INTR2002-00136',
      });
    });
  });

  describe('invalid or special file numbers', () => {
    it('rejects empty strings', () => {
      expect(normalizeFileNumber('')).toEqual({
        ok: false,
        reason: 'empty',
        raw: '',
      });
    });

    it('rejects whitespace-only strings', () => {
      expect(normalizeFileNumber('   ')).toEqual({
        ok: false,
        reason: 'empty',
        raw: '   ',
      });
    });

    it('rejects DRAFT file numbers', () => {
      const result: NormalizeResult = normalizeFileNumber(
        'DRAFT-SAT-LOA-20250915-00277',
      );
      expect(result).toEqual({
        ok: false,
        reason: 'draft',
        raw: 'DRAFT-SAT-LOA-20250915-00277',
      });
    });

    it('rejects garbage input', () => {
      const result: NormalizeResult = normalizeFileNumber('-254587');
      expect(result).toEqual({
        ok: false,
        reason: 'unparseable',
        raw: '-254587',
      });
    });
  });

  describe('round-trip: normalizing twice yields the same result', () => {
    const inputs: string[] = [
      'SES-LIC-19860303-00312',
      'SESLIC1986030300312',
      'SPCNEWINTR200200136',
      'SPC-NEW-INTR2002-00136',
      'SEST/C1960010100001',
    ];

    it.each(inputs)(
      'normalizeFileNumber(normalizeFileNumber(%s)) is idempotent',
      (input: string) => {
        const first: NormalizeResult = normalizeFileNumber(input);
        if (!first.ok) throw new Error(`Expected ok for ${input}`);
        const second: NormalizeResult = normalizeFileNumber(first.fileNumber);
        expect(second).toEqual(first);
      },
    );
  });
});
