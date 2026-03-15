import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchWithRetry } from './fetch-retry.ts';

/**
 * Build a deterministic local path for an attachment file.
 * Pattern: {basePath}/{subsystem}/{hyphenatedFileNumber}/{attachmentKey}.{ext}
 */
export function attachmentStoragePath(
  basePath: string,
  subsystem: string,
  hyphenatedFileNumber: string,
  attachmentKey: number,
  extension: string,
): string {
  return join(
    basePath,
    subsystem,
    hyphenatedFileNumber,
    `${String(attachmentKey)}.${extension}`,
  );
}

/**
 * Ensure a download URL ends with `.pdf` (fcc.report's raw-file suffix).
 * Existing DB rows may lack this suffix.
 */
export function normalizeDownloadUrl(url: string): string {
  return url.endsWith('.pdf') ? url : `${url}.pdf`;
}

/**
 * Download a file from a URL and save it to destPath.
 * Creates parent directories as needed.
 * Normalizes the URL to append `.pdf` for raw file retrieval from fcc.report.
 * Throws if the response is an FCC "Access Denied" error page.
 */
export async function downloadFile(
  url: string,
  destPath: string,
): Promise<{ fileSizeBytes: number; contentType: string | null }> {
  await mkdir(dirname(destPath), { recursive: true });

  const fetchUrl: string = normalizeDownloadUrl(url);
  const response: Response = await fetchWithRetry(fetchUrl);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${String(response.status)} ${response.statusText} for ${fetchUrl}`,
    );
  }

  const contentType: string | null =
    response.headers.get('content-type') ?? null;
  const buffer: ArrayBuffer = await response.arrayBuffer();

  // Detect FCC "Access Denied" error pages
  const baseContentType: string = (contentType ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (baseContentType === 'text/html') {
    const text: string = new TextDecoder().decode(buffer);
    if (text.includes('Access Denied')) {
      throw new Error(`Access Denied for ${fetchUrl}`);
    }
  }

  await writeFile(destPath, Buffer.from(buffer));

  const fileSizeBytes: number = buffer.byteLength;
  return { fileSizeBytes, contentType };
}

/** Check whether a file exists at the given path. */
export function fileExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Find an existing file for a given attachment key in its expected directory.
 * Returns the path and size if found, or null if no file exists.
 * Scans for any extension since we may not know the content type upfront.
 */
export async function findExistingAttachment(
  basePath: string,
  subsystem: string,
  hyphenatedFileNumber: string,
  attachmentKey: number,
): Promise<{ path: string; fileSizeBytes: number } | null> {
  const { readdir } = await import('node:fs/promises');
  const dir: string = join(basePath, subsystem, hyphenatedFileNumber);
  const prefix: string = `${String(attachmentKey)}.`;

  try {
    const entries: string[] = await readdir(dir);
    const match: string | undefined = entries.find((e) => e.startsWith(prefix));
    if (match == null) {
      return null;
    }
    const fullPath: string = join(dir, match);
    const stats = await stat(fullPath);
    return { path: fullPath, fileSizeBytes: stats.size };
  } catch {
    return null;
  }
}

/** Get file size in bytes, or null if the file doesn't exist. */
export async function getFileSize(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.size;
  } catch {
    return null;
  }
}
