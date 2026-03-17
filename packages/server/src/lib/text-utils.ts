import { createHash } from 'node:crypto';

/**
 * Compute an MD5 hex digest of the given text.
 * Used for deduplication: skip re-processing when source text hasn't changed.
 */
export function computeTextChecksum(text: string): string {
  return createHash('md5').update(text).digest('hex');
}
