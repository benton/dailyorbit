import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchWithRetry } from './fetch-retry.ts';

/**
 * Build a deterministic local path for an attachment file.
 * Pattern: {basePath}/{subsystem}/{hyphenatedFileNumber}/{attachmentKey}.pdf
 */
export function attachmentStoragePath(
  basePath: string,
  subsystem: string,
  hyphenatedFileNumber: string,
  attachmentKey: number,
): string {
  return join(
    basePath,
    subsystem,
    hyphenatedFileNumber,
    `${String(attachmentKey)}.pdf`,
  );
}

/**
 * Download a file from a URL and save it to destPath.
 * Creates parent directories as needed.
 */
export async function downloadFile(
  url: string,
  destPath: string,
): Promise<{ fileSizeBytes: number }> {
  await mkdir(dirname(destPath), { recursive: true });

  const response: Response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${String(response.status)} ${response.statusText} for ${url}`,
    );
  }

  const buffer: ArrayBuffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));

  const fileSizeBytes: number = buffer.byteLength;
  return { fileSizeBytes };
}

/** Check whether a file exists at the given path. */
export function fileExists(path: string): boolean {
  return existsSync(path);
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
