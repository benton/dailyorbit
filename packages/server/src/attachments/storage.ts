import { fetchWithRetry } from './fetch-retry.ts';

/** Thrown when an authenticated ServiceNow session has expired (HTTP 302 to login). */
export class SessionExpiredError extends Error {
  constructor(url: string) {
    super(`Session expired (HTTP 302 redirect) for ${url}`);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Canary download: reproduces the working test_icfs_auth_download.sh Node.js
 * fetch (Step 5) line-for-line, with a log after every operation.
 * Returns true if the download yielded binary content, false if it got HTML.
 */
export async function canaryDownload(
  url: string,
  cookies: string,
  log: (msg: string) => void,
): Promise<boolean> {
  log(`[canary] url=${url}`);
  log(`[canary] cookie count=${String(cookies.split('; ').length)}`);
  log(`[canary] cookie length=${String(cookies.length)}`);
  log(`[canary] cookie first 50 chars=${cookies.slice(0, 50)}`);

  const headers: Record<string, string> = {
    Cookie: cookies,
    'User-Agent':
      'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://fccprod.servicenowservices.com/icfs',
  };
  log(`[canary] headers=${JSON.stringify(Object.keys(headers))}`);

  log('[canary] calling fetch() with redirect: follow ...');
  const resp: Response = await fetch(url, { headers, redirect: 'follow' });

  log(`[canary] status=${String(resp.status)} ${resp.statusText}`);
  log(`[canary] content-type=${resp.headers.get('content-type')}`);
  log(`[canary] final url=${resp.url}`);
  log(`[canary] redirected=${String(resp.redirected)}`);

  const buf: ArrayBuffer = await resp.arrayBuffer();
  log(`[canary] body size=${String(buf.byteLength)}`);

  const ct: string = (resp.headers.get('content-type') || '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (ct === 'text/html') {
    log(`[canary] FAIL: got text/html (${String(buf.byteLength)} bytes)`);
    return false;
  }

  const hex: string = Buffer.from(buf.slice(0, 4)).toString('hex');
  log(`[canary] binary: ${String(buf.byteLength)} bytes, magic: ${hex}`);
  log(
    `[canary] ${hex === '25504446' ? 'SUCCESS: PDF' : 'SUCCESS: non-PDF binary'}`,
  );
  return true;
}

export type DownloadFileOptions = {
  /** Cookie header string for authenticated downloads */
  cookies?: string | undefined;
};

/** Chromium User-Agent to avoid ServiceNow anti-bot detection */
const BROWSER_USER_AGENT: string =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

  const headers: Record<string, string> = {};
  if (isAuthenticated) {
    headers['Cookie'] = options!.cookies!;
    headers['User-Agent'] = BROWSER_USER_AGENT;
    headers['Referer'] = 'https://fccprod.servicenowservices.com/icfs';
  }

  const response: Response = await fetchWithRetry(fetchUrl, {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    // Always follow redirects — ServiceNow may redirect authenticated
    // requests legitimately.  We detect session expiry from the response
    // body / final URL instead of the status code.
    followRedirects: true,
  });

  if (!response.ok) {
    throw new Error(
      `Download failed: ${String(response.status)} ${response.statusText} for ${fetchUrl}`,
    );
  }

  const contentType: string | null =
    response.headers.get('content-type') ?? null;
  const arrayBuffer: ArrayBuffer = await response.arrayBuffer();
  const buffer: Buffer = Buffer.from(arrayBuffer);

  // Detect session expiry: if an authenticated download returns HTML that
  // looks like a login/nav page, the session has expired.  Note that some
  // sys_attachment.do URLs legitimately return HTML content (e.g. FCC filing
  // forms stored as .htm), so we check for specific auth-failure markers
  // rather than treating all text/html as expired.
  const baseContentType: string = (contentType ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (isAuthenticated && baseContentType === 'text/html') {
    const bodyPreview: string = new TextDecoder().decode(
      arrayBuffer.slice(0, 2000),
    );
    const isAuthFailure: boolean =
      // ServiceNow nav frame / login page markers
      bodyPreview.includes('nav_to.do') ||
      bodyPreview.includes('sysparm_url') ||
      bodyPreview.includes('/login.do') ||
      // Okta login page markers
      bodyPreview.includes('okta') ||
      bodyPreview.includes('signin-widget') ||
      // Generic session markers
      bodyPreview.includes('session_expired') ||
      bodyPreview.includes('login_redirect');

    if (isAuthFailure) {
      console.error(
        `[downloadFile] SESSION EXPIRED — url=${fetchUrl} finalUrl=${response.url} contentType=${contentType} bodySize=${String(arrayBuffer.byteLength)} bodyPreview=${bodyPreview.slice(0, 500)}`,
      );
      throw new SessionExpiredError(fetchUrl);
    }
  }

  // Detect FCC "Access Denied" error pages
  if (baseContentType === 'text/html') {
    const text: string = new TextDecoder().decode(arrayBuffer);
    if (text.includes('Access Denied')) {
      throw new Error(`Access Denied for ${fetchUrl}`);
    }
  }

  const fileSizeBytes: number = buffer.byteLength;
  return { buffer, fileSizeBytes, contentType };
}
