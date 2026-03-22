import { describe, expect, it } from 'vitest';
import { formatCostCents } from './ChatCostBadge.tsx';

describe('formatCostCents', () => {
  it('formats zero cents as $0.00', () => {
    expect(formatCostCents(0)).toBe('$0.00');
  });

  it('formats sub-cent amounts with 3+ decimal places', () => {
    expect(formatCostCents(0.3)).toBe('$0.003');
    expect(formatCostCents(0.05)).toBe('$0.0005');
    expect(formatCostCents(0.999)).toBe('$0.00999');
  });

  it('formats amounts between 1 cent and $9.99 with 2 decimal places', () => {
    expect(formatCostCents(1)).toBe('$0.01');
    expect(formatCostCents(24)).toBe('$0.24');
    expect(formatCostCents(99)).toBe('$0.99');
    expect(formatCostCents(999)).toBe('$9.99');
  });

  it('formats amounts >= $10 with 2 decimal places', () => {
    expect(formatCostCents(1000)).toBe('$10.00');
    expect(formatCostCents(1250)).toBe('$12.50');
    expect(formatCostCents(10000)).toBe('$100.00');
  });

  it('handles fractional cents in the mid range', () => {
    expect(formatCostCents(3.5)).toBe('$0.04');
    expect(formatCostCents(150.7)).toBe('$1.51');
  });
});
