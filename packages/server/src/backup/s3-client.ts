import { PutObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, statSync } from 'node:fs';

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
  listSnapshots: () => Promise<S3SnapshotEntry[]>;
};

export function createS3Uploader(config: S3UploaderConfig): S3Uploader {
  const client: S3Client = new S3Client({ region: config.region });

  async function upload(localPath: string, s3Key: string): Promise<void> {
    const fullKey: string = `${config.prefix}${s3Key}`;
    const stat = statSync(localPath);
    const stream = createReadStream(localPath);

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: fullKey,
        Body: stream,
        ContentLength: stat.size,
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

  return { upload, listSnapshots };
}
