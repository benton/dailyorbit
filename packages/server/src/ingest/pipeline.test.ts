import { describe, expect, it } from 'vitest';
import { parseCountsManifest } from './pipeline.ts';

describe('parseCountsManifest', () => {
  it('parses wc -l style manifest into filename→count map', () => {
    const manifest: string = [
      '    82 /opt/ibfsbatch/daily_download/output/status_code.dat',
      '  160001 /opt/ibfsbatch/daily_download/output/main.dat',
      ' 3529236 total',
    ].join('\n');

    const counts: Map<string, number> = parseCountsManifest(manifest);

    expect(counts.get('status_code.dat')).toBe(82);
    expect(counts.get('main.dat')).toBe(160001);
    expect(counts.has('total')).toBe(false);
  });
});
