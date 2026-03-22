import { describe, expect, it } from 'vitest';
import { formatCostCents } from './ChatCostBadge.tsx';

describe('formatCostCents', () => {
  it('formats zero as $0.00', () => {
    expect(formatCostCents(0)).toBe('$0.00');
  });

  it('rounds sub-cent amounts up to minimum $0.01', () => {
    expect(formatCostCents(0.001)).toBe('$0.01');
    expect(formatCostCents(0.3)).toBe('$0.01');
    expect(formatCostCents(0.999)).toBe('$0.01');
  });

  it('rounds fractional cents to nearest cent', () => {
    expect(formatCostCents(1.4)).toBe('$0.01');
    expect(formatCostCents(1.5)).toBe('$0.02');
    expect(formatCostCents(3.5)).toBe('$0.04');
    expect(formatCostCents(150.7)).toBe('$1.51');
  });

  it('formats whole cent amounts', () => {
    expect(formatCostCents(1)).toBe('$0.01');
    expect(formatCostCents(24)).toBe('$0.24');
    expect(formatCostCents(99)).toBe('$0.99');
    expect(formatCostCents(999)).toBe('$9.99');
  });

  it('formats dollar-scale amounts', () => {
    expect(formatCostCents(1000)).toBe('$10.00');
    expect(formatCostCents(1250)).toBe('$12.50');
    expect(formatCostCents(10000)).toBe('$100.00');
  });

  it('treats negative values as zero', () => {
    expect(formatCostCents(-5)).toBe('$0.00');
  });
});
