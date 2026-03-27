import type { StorageBackend } from './storage-backend.ts';
import { createFsBackend, createS3Backend } from './storage-backend.ts';

/**
 * Create a StorageBackend from the application's ConfigService.
 * All storage config keys are non-encrypted, so we cast to string.
 */
export function createStorageFromConfig(config: {
  get(key: string): unknown;
}): StorageBackend {
  const backend: string = String(config.get('storageBackend') || 'fs');

  if (backend === 's3') {
    const bucket: string = String(config.get('storageBucket') || '');
    const region: string = String(config.get('storageRegion') || 'us-east-2');
    const prefix: string = String(
      config.get('storagePrefix') || 'attachments/',
    );
    if (!bucket) {
      throw new Error(
        'storageBackend is "s3" but storageBucket is not configured',
      );
    }
    return createS3Backend(bucket, region, prefix);
  }

  const root: string = String(
    config.get('storageFsRoot') || 'data/attachments',
  );
  return createFsBackend(root);
}
