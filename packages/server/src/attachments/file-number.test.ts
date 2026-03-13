import { describe, expect, it } from 'vitest';
import { compactToHyphenated } from './file-number.ts';

describe('compactToHyphenated', () => {
  const cases: Array<{
    compact: string;
    subsystem: string;
    appType: string;
    expected: string;
  }> = [
    {
      compact: 'SATSTA2023061400142',
      subsystem: 'SAT',
      appType: 'STA',
      expected: 'SAT-STA-20230614-00142',
    },
    {
      compact: 'SESLOA2024010100001',
      subsystem: 'SES',
      appType: 'LOA',
      expected: 'SES-LOA-20240101-00001',
    },
    {
      compact: 'ITC21420200315000099',
      subsystem: 'ITC',
      appType: '214',
      expected: 'ITC-214-20200315-000099',
    },
    {
      compact: '325NEW2019080100003',
      subsystem: '325',
      appType: 'NEW',
      expected: '325-NEW-20190801-00003',
    },
    {
      compact: 'SATTC2022110100050',
      subsystem: 'SAT',
      appType: 'T/C',
      expected: 'SAT-T/C-20221101-00050',
    },
    {
      compact: 'SATMOD2021030100200',
      subsystem: 'SAT',
      appType: 'MOD',
      expected: 'SAT-MOD-20210301-00200',
    },
  ];

  it.each(cases)(
    'converts $compact -> $expected',
    ({ compact, subsystem, appType, expected }) => {
      const result: string = compactToHyphenated(compact, subsystem, appType);
      expect(result).toEqual(expected);
    },
  );

  it('is idempotent — round-trip preserves all components', () => {
    const compact: string = 'SATSTA2023061400142';
    const result: string = compactToHyphenated(compact, 'SAT', 'STA');
    const parts: string[] = result.split('-');
    expect(parts[0]).toEqual('SAT');
    expect(parts[1]).toEqual('STA');
    expect(parts[2]).toMatch(/^\d{8}$/);
    expect(parts[3]).toMatch(/^\d+$/);
  });
});
