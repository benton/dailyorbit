import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync: (
  file: string,
  args: readonly string[],
  options: { timeout: number; encoding: BufferEncoding },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile) as any;

export type DetectedContentType = {
  mimeType: string;
  isDifferent: boolean;
  declaredType: string | null;
};

/**
 * Detect the actual content type of a file using the system `file` command.
 * Compares the detected MIME type against the declared (HTTP header) type
 * and reports whether they differ.
 *
 * Uses async execFile to avoid blocking the Node.js event loop.
 */
export async function detectContentType(
  filePath: string,
  declaredType: string | null,
): Promise<DetectedContentType> {
  const { stdout: raw } = await execFileAsync(
    'file',
    ['--brief', '--mime-type', filePath],
    {
      timeout: 5_000,
      encoding: 'utf-8',
    },
  );
  const stdout: string = raw.trim();

  // `file` exits 0 even on errors (e.g. "cannot open ...") — detect and throw.
  // A valid MIME type is a single token like "application/pdf" with no spaces.
  if (stdout.includes(' ') || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(stdout)) {
    throw new Error(`file command returned unexpected output: ${stdout}`);
  }

  return {
    mimeType: stdout,
    isDifferent: declaredType != null && stdout !== declaredType,
    declaredType,
  };
}
