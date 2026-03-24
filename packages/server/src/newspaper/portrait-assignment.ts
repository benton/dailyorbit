import { createHash } from 'node:crypto';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewspaperImage } from './types.ts';
import { listImagesByType } from './repository.ts';

/**
 * Deterministically assign a portrait index to a person name.
 * The same name always maps to the same portrait.
 */
export function assignPortrait(name: string, librarySize: number): number {
  if (librarySize <= 0) return 0;
  const hash: string = createHash('md5')
    .update(name.toLowerCase().trim())
    .digest('hex');
  return parseInt(hash.slice(0, 8), 16) % librarySize;
}

/**
 * Get the portrait for a given person name.
 * Returns null if the portrait library hasn't been generated.
 */
export async function getPortraitForPerson(
  conn: DuckDBConnection,
  personName: string,
): Promise<NewspaperImage | null> {
  const portraits: NewspaperImage[] = await listImagesByType(conn, 'portrait');
  if (portraits.length === 0) return null;
  const index: number = assignPortrait(personName, portraits.length);
  return portraits[index]!;
}
