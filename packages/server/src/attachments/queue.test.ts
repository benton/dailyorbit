import { describe, expect, it } from 'vitest';
import { processQueue } from './queue.ts';

describe('processQueue', () => {
  it('processes all items and returns results in order', async () => {
    const items: number[] = [1, 2, 3, 4, 5];
    const results: (number | undefined)[] = await processQueue(
      items,
      async (n: number) => n * 10,
      { concurrency: 2 },
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('respects concurrency limit', async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;
    const items: number[] = [1, 2, 3, 4, 5, 6, 7, 8];

    await processQueue(
      items,
      async (n: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return n;
      },
      { concurrency: 3 },
    );

    expect(maxInFlight).toEqual(3);
  });

  it('concurrency=1 processes sequentially', async () => {
    const order: number[] = [];
    const items: number[] = [1, 2, 3];

    await processQueue(
      items,
      async (n: number) => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 10));
        return n;
      },
      { concurrency: 1 },
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it('applies delay between task starts', async () => {
    const startTimes: number[] = [];
    const items: number[] = [1, 2, 3];

    await processQueue(
      items,
      async (n: number) => {
        startTimes.push(Date.now());
        return n;
      },
      { concurrency: 1, delayMs: 50 },
    );

    // With concurrency=1 and 50ms delay, each start should be ≥50ms apart
    for (let i: number = 1; i < startTimes.length; i++) {
      const gap: number = startTimes[i]! - startTimes[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(45); // small tolerance
    }
  });

  it('returns empty array for empty input', async () => {
    const results: (number | undefined)[] = await processQueue(
      [],
      async (n: number) => n,
      {
        concurrency: 4,
      },
    );
    expect(results).toEqual([]);
  });

  it('collects errors without stopping other tasks', async () => {
    const items: number[] = [1, 2, 3, 4];
    const results = await processQueue(
      items,
      async (n: number) => {
        if (n === 2) throw new Error('boom');
        return n * 10;
      },
      { concurrency: 2, onError: () => {} },
    );

    // Item 2 should be undefined (failed), others should succeed
    expect(results[0]).toEqual(10);
    expect(results[1]).toEqual(undefined);
    expect(results[2]).toEqual(30);
    expect(results[3]).toEqual(40);
  });
});
