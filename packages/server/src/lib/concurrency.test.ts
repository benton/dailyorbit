import { describe, expect, it } from 'vitest';
import { processWithConcurrency } from './concurrency.ts';

describe('processWithConcurrency', () => {
  it('processes all items and returns results in order', async () => {
    const items: number[] = [10, 20, 30];
    const results: number[] = await processWithConcurrency(
      items,
      2,
      async (n: number) => n * 2,
    );
    expect(results).toEqual([20, 40, 60]);
  });

  it('returns empty array for empty input', async () => {
    const results: string[] = await processWithConcurrency(
      [],
      5,
      async (s: string) => s.toUpperCase(),
    );
    expect(results).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent: number = 0;
    let currentConcurrent: number = 0;

    const items: number[] = [1, 2, 3, 4, 5, 6];
    await processWithConcurrency(items, 2, async (_n: number) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentConcurrent--;
      return _n;
    });

    expect(maxConcurrent).toEqual(2);
  });

  it('handles concurrency greater than item count', async () => {
    const items: string[] = ['a', 'b'];
    const results: string[] = await processWithConcurrency(
      items,
      100,
      async (s: string) => s.toUpperCase(),
    );
    expect(results).toEqual(['A', 'B']);
  });

  it('propagates errors from the processing function', async () => {
    const items: number[] = [1, 2, 3];
    await expect(
      processWithConcurrency(items, 2, async (n: number) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
