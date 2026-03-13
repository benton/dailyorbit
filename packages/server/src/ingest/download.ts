import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Default FTP URL for the IBFS bulk data zip */
export const DEFAULT_SOURCE_URL: string =
  'ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip';

/** Options for the download-and-extract stage */
export type DownloadOptions = {
  /** URL to fetch the zip from (defaults to DEFAULT_SOURCE_URL) */
  sourceUrl?: string | undefined;
  /** Directory to extract into (defaults to tmp/IBFS) */
  extractDir?: string | undefined;
  /** Callback for progress reporting */
  onProgress?: ((message: string) => void) | undefined;
};

/** Result of the download-and-extract stage */
export type DownloadResult = {
  /** Absolute path to the directory containing extracted .dat files */
  datDir: string;
  /** Size of the downloaded zip in bytes, or undefined if skipped */
  zipSizeBytes: number | undefined;
};

/**
 * Derives the local zip path from the extract directory.
 * e.g. extractDir = '/foo/tmp/IBFS' -> '/foo/tmp/IBFS.zip'
 */
export function zipPathForExtractDir(extractDir: string): string {
  return `${extractDir}.zip`;
}

/**
 * Downloads IBFS.zip from the FCC FTP server and extracts it.
 *
 * Uses `curl` for FTP download and `unzip` for extraction,
 * avoiding any npm dependency on FTP or zip libraries.
 */
export function downloadAndExtract(
  options: DownloadOptions = {},
): DownloadResult {
  const sourceUrl: string = options.sourceUrl ?? DEFAULT_SOURCE_URL;
  const extractDir: string = options.extractDir ?? 'tmp/IBFS';
  const log: (message: string) => void = options.onProgress ?? console.log;

  const absExtractDir: string = resolve(extractDir);
  const zipPath: string = zipPathForExtractDir(absExtractDir);

  // Ensure parent directory exists
  const parentDir: string = dirname(absExtractDir);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Stage 1: Download
  log(`Downloading ${sourceUrl} ...`);
  try {
    execFileSync(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--output',
        zipPath,
        sourceUrl,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
  } catch (err: unknown) {
    throw new Error(`Download failed from ${sourceUrl}: ${String(err)}`);
  }

  const zipSizeBytes: number = statSync(zipPath).size;
  log(`Downloaded ${String(zipSizeBytes)} bytes to ${zipPath}`);

  // Stage 2: Extract
  if (!existsSync(absExtractDir)) {
    mkdirSync(absExtractDir, { recursive: true });
  }

  log(`Extracting to ${absExtractDir} ...`);
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', absExtractDir], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err: unknown) {
    throw new Error(`Extraction failed for ${zipPath}: ${String(err)}`);
  }
  log('Extraction complete');

  return {
    datDir: absExtractDir,
    zipSizeBytes,
  };
}
