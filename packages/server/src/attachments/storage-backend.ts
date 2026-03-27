import { Operator } from 'opendal';

/**
 * Abstraction over file storage. Wraps OpenDAL Operator to support
 * local filesystem (dev), S3 (production), and memory (tests).
 */
export type StorageBackend = {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<{ contentLength: number } | null>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  rename(src: string, dest: string): Promise<void>;
};

function wrapOperator(op: Operator): StorageBackend {
  return {
    async write(key: string, data: Buffer): Promise<void> {
      await op.write(key, data);
    },

    async read(key: string): Promise<Buffer> {
      return await op.read(key);
    },

    async stat(key: string): Promise<{ contentLength: number } | null> {
      try {
        const metadata = await op.stat(key);
        return { contentLength: Number(metadata.contentLength) };
      } catch {
        return null;
      }
    },

    async list(prefix: string): Promise<string[]> {
      const entries = await op.list(prefix);
      return entries.map((e) => e.path());
    },

    async delete(key: string): Promise<void> {
      await op.delete(key);
    },

    async rename(src: string, dest: string): Promise<void> {
      try {
        await op.rename(src, dest);
      } catch {
        // Fallback: copy + delete (rename not supported on all backends)
        const data: Buffer = await op.read(src);
        await op.write(dest, data);
        await op.delete(src);
      }
    },
  };
}

export function createFsBackend(rootPath: string): StorageBackend {
  const op: Operator = new Operator('fs', { root: rootPath });
  return wrapOperator(op);
}

export function createS3Backend(
  bucket: string,
  region: string,
  root?: string | undefined,
): StorageBackend {
  const options: Record<string, string> = { bucket, region };
  if (root != null) {
    options.root = root;
  }
  const op: Operator = new Operator('s3', options);
  return wrapOperator(op);
}

export function createMemoryBackend(): StorageBackend {
  const op: Operator = new Operator('memory');
  return wrapOperator(op);
}
