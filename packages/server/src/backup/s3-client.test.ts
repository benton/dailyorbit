import { describe, expect, it } from 'vitest';
import { createS3Uploader, type S3Uploader } from './s3-client.ts';

describe('createS3Uploader', () => {
  it('returns an uploader with upload and listSnapshots methods', () => {
    const uploader: S3Uploader = createS3Uploader({
      bucket: 'test-bucket',
      prefix: 'db/',
      region: 'us-east-2',
    });
    expect(typeof uploader.upload).toBe('function');
    expect(typeof uploader.copyObject).toBe('function');
    expect(typeof uploader.listSnapshots).toBe('function');
    expect(typeof uploader.deleteObject).toBe('function');
  });
});
