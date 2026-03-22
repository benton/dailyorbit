export type QueueOptions<T> = {
  concurrency: number;
  delayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onError?: (error: unknown, item: T, index: number) => void;
  onItemComplete?: (index: number, total: number) => void;
};

/**
 * Process an array of items with bounded concurrency.
 * Returns results in the same order as the input array.
 * Failed items produce undefined in the results array if onError is provided;
 * otherwise the error propagates.
 *
 * delayMs is applied per-worker between consecutive tasks.
 */
export async function processQueue<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: QueueOptions<T>,
): Promise<(R | undefined)[]> {
  const { concurrency, delayMs = 0, signal, onError, onItemComplete } = options;
  const results: (R | undefined)[] = Array.from<R | undefined>({
    length: items.length,
  });
  let nextIndex: number = 0;
  let completedCount: number = 0;

  async function worker(): Promise<void> {
    let isFirst: boolean = true;
    while (nextIndex < items.length) {
      if (signal?.aborted) break;
      const idx: number = nextIndex++;
      const item: T = items[idx]!;

      if (delayMs > 0 && !isFirst) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      isFirst = false;

      try {
        results[idx] = await fn(item, idx);
      } catch (error: unknown) {
        if (onError != null) {
          onError(error, item, idx);
          results[idx] = undefined;
        } else {
          throw error;
        }
      }
      completedCount++;
      if (onItemComplete != null) {
        onItemComplete(completedCount, items.length);
      }
    }
  }

  const workerCount: number = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];
  for (let i: number = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}
