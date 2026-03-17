import { describe, expect, it } from 'vitest';
import { computeTextChecksum } from './text-utils.ts';

describe('computeTextChecksum', () => {
  it('returns a 32-char hex MD5 digest', () => {
    const result: string = computeTextChecksum('hello world');
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for identical input', () => {
    const input: string = 'FCC filing SAT-LOA-20240101-00001';
    expect(computeTextChecksum(input)).toEqual(computeTextChecksum(input));
  });

  it('produces different checksums for different input', () => {
    const a: string = computeTextChecksum('application A');
    const b: string = computeTextChecksum('application B');
    expect(a).not.toEqual(b);
  });

  it('handles empty string', () => {
    const result: string = computeTextChecksum('');
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it('handles unicode text', () => {
    const result: string = computeTextChecksum('日本語テスト 🛰️');
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });
});
