import { readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getLogger } from '../lib/logger.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Extract the S3 key from a local image path.
 * Strips everything before "newspaper/images/".
 */
export function imageS3Key(localPath: string): string {
  const marker: string = 'newspaper/images/';
  const idx: number = localPath.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Path does not contain '${marker}': ${localPath}`);
  }
  return localPath.slice(idx);
}

/**
 * Upload a single newspaper image to S3.
 * Returns the S3 key on success.
 */
export async function uploadNewspaperImage(
  localPath: string,
  bucket: string,
  region: string,
): Promise<string> {
  const log = getLogger();
  const key: string = imageS3Key(localPath);
  const ext: string = localPath.slice(localPath.lastIndexOf('.'));
  const contentType: string = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  // Library images are immutable; edition images change at most once per day
  const isLibrary: boolean = key.includes('/library/');
  const cacheControl: string = isLibrary
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';

  const body: Buffer = await readFile(localPath);
  const client: S3Client = new S3Client({ region });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );

  log.info({ key, bucket }, 'Uploaded newspaper image to S3');
  return key;
}
