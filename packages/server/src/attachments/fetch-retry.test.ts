import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './fetch-retry.ts';

describe('fetchWithRetry', () => {
  const TEST_URL: string = 'https://example.com/test';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns immediately on 200', async () => {
    const ok: Response = new Response('ok', { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(ok);

    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 3,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 4xx errors', async () => {
    const notFound: Response = new Response('not found', { status: 404 });
    vi.mocked(fetch).mockResolvedValueOnce(notFound);

    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 3,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds on recovery', async () => {
    const err520: Response = new Response('', { status: 520 });
    const err521: Response = new Response('', { status: 521 });
    const ok: Response = new Response('recovered', { status: 200 });
    vi.mocked(fetch)
      .mockResolvedValueOnce(err520)
      .mockResolvedValueOnce(err521)
      .mockResolvedValueOnce(ok);

    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 4,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors and succeeds on recovery', async () => {
    const ok: Response = new Response('recovered', { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok);

    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 3,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 5xx response after exhausting all retries', async () => {
    const err500: Response = new Response('server error', { status: 500 });
    vi.mocked(fetch).mockResolvedValue(err500);

    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 2,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(500);
    // 1 initial + 2 retries = 3 total attempts
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns the 5xx response on final attempt instead of throwing', async () => {
    const err503: Response = new Response('unavailable', { status: 503 });
    vi.mocked(fetch).mockResolvedValue(err503);

    // With maxRetries=0, it should return the 5xx response directly
    const result: Response = await fetchWithRetry(TEST_URL, {
      maxRetries: 0,
      initialDelayMs: 1,
    });
    expect(result.status).toEqual(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff between retries', async () => {
    const timestamps: number[] = [];
    const err500: Response = new Response('', { status: 500 });
    const ok: Response = new Response('ok', { status: 200 });

    vi.mocked(fetch).mockImplementation(async () => {
      timestamps.push(Date.now());
      if (timestamps.length < 4) return err500;
      return ok;
    });

    await fetchWithRetry(TEST_URL, {
      maxRetries: 4,
      initialDelayMs: 50,
      maxDelayMs: 5000,
    });

    expect(timestamps.length).toEqual(4);
    // Each gap should be >= the previous (exponential), with jitter tolerance
    const gap1: number = timestamps[1]! - timestamps[0]!;
    const gap2: number = timestamps[2]! - timestamps[1]!;
    const gap3: number = timestamps[3]! - timestamps[2]!;
    // First retry: ~50ms base, second: ~100ms, third: ~200ms
    // With jitter (0.5-1.0x), minimums are ~25ms, ~50ms, ~100ms
    expect(gap1).toBeGreaterThanOrEqual(20);
    expect(gap2).toBeGreaterThanOrEqual(40);
    expect(gap3).toBeGreaterThanOrEqual(80);
  });
});
