/**
 * Process items with a bounded concurrency pool.
 * Returns results in the same order as the input items.
 */
export async function processWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from<R>({ length: items.length });
  let nextIndex: number = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx: number = nextIndex++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
