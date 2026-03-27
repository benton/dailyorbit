import { fetchWithRetry } from './fetch-retry.ts';

/** Thrown when an authenticated ServiceNow session has expired (HTTP 302 to login). */
export class SessionExpiredError extends Error {
  constructor(url: string) {
    super(`Session expired (HTTP 302 redirect) for ${url}`);
    this.name = 'SessionExpiredError';
  }
}

export type DownloadFileOptions = {
  /** Cookie header string for authenticated downloads */
  cookies?: string | undefined;
};

/**
 * Build a deterministic relative storage key for an attachment file.
 * Pattern: {subsystem}/{hyphenatedFileNumber}/{attachmentKey}.{ext}
 */
export function attachmentStorageKey(
  subsystem: string,
  hyphenatedFileNumber: string,
  attachmentKey: number,
  extension: string,
): string {
  return `${subsystem}/${hyphenatedFileNumber}/${String(attachmentKey)}.${extension}`;
}

/**
 * Ensure a download URL ends with `.pdf` (fcc.report's raw-file suffix).
 * Existing DB rows may lack this suffix.
 */
export function normalizeDownloadUrl(url: string): string {
  return url.endsWith('.pdf') ? url : `${url}.pdf`;
}

/**
 * Download a file from a URL and return its content as a Buffer.
 * Normalizes the URL to append `.pdf` for raw file retrieval from fcc.report
 * (skipped for authenticated ServiceNow downloads).
 * Throws SessionExpiredError if an authenticated request gets a 302 redirect.
 * Throws if the response is an FCC "Access Denied" error page.
 */
export async function downloadFile(
  url: string,
  options?: DownloadFileOptions | undefined,
): Promise<{
  buffer: Buffer;
  fileSizeBytes: number;
  contentType: string | null;
}> {
  const isAuthenticated: boolean = options?.cookies != null;

  // Skip .pdf normalization for authenticated ServiceNow URLs
  const fetchUrl: string = isAuthenticated ? url : normalizeDownloadUrl(url);

  const response: Response = await fetchWithRetry(fetchUrl, {
    headers: isAuthenticated ? { Cookie: options!.cookies! } : undefined,
    followRedirects: !isAuthenticated,
  });

  // For authenticated requests, a 302 means session expired
  if (isAuthenticated && (response.status === 302 || response.status === 301)) {
    throw new SessionExpiredError(fetchUrl);
  }

  if (!response.ok) {
    throw new Error(
      `Download failed: ${String(response.status)} ${response.statusText} for ${fetchUrl}`,
    );
  }

  const contentType: string | null =
    response.headers.get('content-type') ?? null;
  const arrayBuffer: ArrayBuffer = await response.arrayBuffer();
  const buffer: Buffer = Buffer.from(arrayBuffer);

  // Detect FCC "Access Denied" error pages
  const baseContentType: string = (contentType ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (baseContentType === 'text/html') {
    const text: string = new TextDecoder().decode(arrayBuffer);
    if (text.includes('Access Denied')) {
      throw new Error(`Access Denied for ${fetchUrl}`);
    }
  }

  const fileSizeBytes: number = buffer.byteLength;
  return { buffer, fileSizeBytes, contentType };
}
