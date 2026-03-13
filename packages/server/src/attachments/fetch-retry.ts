export type FetchRetryOptions = {
  maxRetries?: number | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
};

const DEFAULT_MAX_RETRIES: number = 4;
const DEFAULT_INITIAL_DELAY_MS: number = 1000;
const DEFAULT_MAX_DELAY_MS: number = 30000;

/**
 * Fetch with exponential backoff and jitter.
 * Retries on 5xx responses and network errors.
 */
export async function fetchWithRetry(
  url: string,
  options?: FetchRetryOptions | undefined,
): Promise<Response> {
  const maxRetries: number = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs: number =
    options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs: number = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: Error | undefined;

  for (let attempt: number = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const baseDelay: number = initialDelayMs * 2 ** (attempt - 1);
      const capped: number = Math.min(baseDelay, maxDelayMs);
      const jitter: number = capped * (0.5 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, jitter));
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }

    if (response.status >= 500 && attempt < maxRetries) {
      lastError = new Error(
        `${url}: ${String(response.status)} ${response.statusText}`,
      );
      continue;
    }

    return response;
  }

  throw lastError ?? new Error(`fetchWithRetry failed for ${url}`);
}
