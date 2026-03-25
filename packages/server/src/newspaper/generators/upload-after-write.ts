import { getConfigService } from '../../lib/config.ts';
import { uploadNewspaperImage } from '../image-upload.ts';
import { getLogger } from '../../lib/logger.ts';

/**
 * Returns an upload function that sends images to S3 if configured,
 * or a no-op if newspaperImagesBucket is empty.
 *
 * The S3 region defaults to us-east-2 (where the infrastructure lives)
 * and is independent of bedrockRegion, which may point to a different
 * region for image generation models.
 */
export function createImageUploader(): (localPath: string) => Promise<void> {
  let bucket: string = '';
  const region: string = process.env.AWS_REGION ?? 'us-east-2';
  try {
    const config = getConfigService();
    bucket = String(config.get('newspaperImagesBucket') ?? '');
  } catch {
    // ConfigService not initialized (e.g. in tests) — no upload
    return async () => {};
  }

  if (!bucket) {
    return async () => {};
  }

  const log = getLogger();
  log.info({ bucket }, 'Newspaper image S3 upload enabled');

  return async (localPath: string): Promise<void> => {
    try {
      await uploadNewspaperImage(localPath, bucket, region);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      log.warn(
        { error: msg, localPath },
        'Failed to upload newspaper image to S3',
      );
    }
  };
}
