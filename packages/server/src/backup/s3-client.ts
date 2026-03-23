import {
  CopyObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';

export type S3UploaderConfig = {
  bucket: string;
  prefix: string;
  region: string;
};

export type S3SnapshotEntry = {
  key: string;
  lastModified: Date;
  sizeBytes: number;
};

export type S3Uploader = {
  upload: (localPath: string, s3Key: string) => Promise<void>;
  copyObject: (sourceKey: string, destKey: string) => Promise<void>;
  listSnapshots: () => Promise<S3SnapshotEntry[]>;
};

export function createS3Uploader(config: S3UploaderConfig): S3Uploader {
  const client: S3Client = new S3Client({ region: config.region });

  async function upload(localPath: string, s3Key: string): Promise<void> {
    const fullKey: string = `${config.prefix}${s3Key}`;
    const stream = createReadStream(localPath);

    const multipartUpload = new Upload({
      client,
      params: {
        Bucket: config.bucket,
        Key: fullKey,
        Body: stream,
      },
      // 100 MB parts, up to 4 concurrent uploads
      partSize: 100 * 1024 * 1024,
      queueSize: 4,
    });

    await multipartUpload.done();
  }

  async function copyObject(sourceKey: string, destKey: string): Promise<void> {
    const fullSource: string = `${config.prefix}${sourceKey}`;
    const fullDest: string = `${config.prefix}${destKey}`;
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${fullSource}`,
        Key: fullDest,
      }),
    );
  }

  async function listSnapshots(): Promise<S3SnapshotEntry[]> {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: config.prefix,
      }),
    );

    const entries: S3SnapshotEntry[] = (result.Contents ?? [])
      .filter((obj) => obj.Key?.endsWith('.duckdb'))
      .map((obj) => ({
        key: obj.Key!,
        lastModified: obj.LastModified ?? new Date(),
        sizeBytes: obj.Size ?? 0,
      }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return entries;
  }

  return { upload, copyObject, listSnapshots };
}
