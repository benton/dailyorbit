import { describe, expect, it } from 'vitest';
import { computeCost, pricedModelIds } from './pricing.ts';

describe('computeCost', () => {
  it('computes cost in cents for Nova Pro', () => {
    const costCents: number = computeCost('us.amazon.nova-pro-v1:0', 1000, 500);
    // input: 1000/1000 * 0.0008 = 0.0008 USD
    // output: 500/1000 * 0.0032 = 0.0016 USD
    // total: 0.0024 USD = 0.24 cents
    expect(costCents).toBeCloseTo(0.24, 4);
  });

  it('computes cost in cents for Nova Micro', () => {
    const costCents: number = computeCost(
      'us.amazon.nova-micro-v1:0',
      10_000,
      2_000,
    );
    // input: 10000/1000 * 0.000035 = 0.00035 USD
    // output: 2000/1000 * 0.00014 = 0.00028 USD
    // total: 0.00063 USD = 0.063 cents
    expect(costCents).toBeCloseTo(0.063, 4);
  });

  it('computes cost for Titan Embed (output tokens are free)', () => {
    const costCents: number = computeCost(
      'amazon.titan-embed-text-v2:0',
      5000,
      0,
    );
    // input: 5000/1000 * 0.00002 = 0.0001 USD = 0.01 cents
    expect(costCents).toBeCloseTo(0.01, 4);
  });

  it('returns 0 for unknown models', () => {
    expect(computeCost('unknown-model', 1000, 1000)).toEqual(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(computeCost('us.amazon.nova-pro-v1:0', 0, 0)).toEqual(0);
  });

  it('handles non-prefixed model IDs', () => {
    const withPrefix: number = computeCost(
      'us.amazon.nova-pro-v1:0',
      1000,
      500,
    );
    const withoutPrefix: number = computeCost(
      'amazon.nova-pro-v1:0',
      1000,
      500,
    );
    expect(withPrefix).toEqual(withoutPrefix);
  });
});

describe('pricedModelIds', () => {
  it('returns a non-empty list of model IDs', () => {
    const ids: string[] = pricedModelIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('us.amazon.nova-pro-v1:0');
    expect(ids).toContain('amazon.titan-embed-text-v2:0');
  });
});
