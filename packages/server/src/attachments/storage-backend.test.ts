import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from './storage-backend.ts';
import type { StorageBackend } from './storage-backend.ts';

describe('StorageBackend (memory)', () => {
  it('write/read round-trip preserves data', async () => {
    const storage: StorageBackend = createMemoryBackend();
    const data: Buffer = Buffer.from('hello world');
    await storage.write('test/file.txt', data);

    const result: Buffer = await storage.read('test/file.txt');
    expect(result.toString()).toEqual('hello world');
  });

  it('write/read preserves binary data with all byte values', async () => {
    const storage: StorageBackend = createMemoryBackend();
    const bytes: number[] = Array.from({ length: 256 }, (_, i: number) => i);
    const data: Buffer = Buffer.from(bytes);
    await storage.write('binary/all-bytes.bin', data);

    const result: Buffer = await storage.read('binary/all-bytes.bin');
    expect(result).toEqual(data);
    expect(result.byteLength).toEqual(256);
  });

  it('read throws for non-existent key', async () => {
    const storage: StorageBackend = createMemoryBackend();

    await expect(storage.read('does-not-exist')).rejects.toThrow();
  });

  it('write overwrites existing key', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('key.txt', Buffer.from('first'));
    await storage.write('key.txt', Buffer.from('second'));

    const result: Buffer = await storage.read('key.txt');
    expect(result.toString()).toEqual('second');
  });

  it('stat returns contentLength for existing key', async () => {
    const storage: StorageBackend = createMemoryBackend();
    const data: Buffer = Buffer.from('12345');
    await storage.write('a/b.bin', data);

    const stat = await storage.stat('a/b.bin');
    expect(stat).toEqual({ contentLength: 5 });
  });

  it('stat returns null for non-existent key', async () => {
    const storage: StorageBackend = createMemoryBackend();

    const stat = await storage.stat('nonexistent');
    expect(stat).toBeNull();
  });

  it('stat returns correct size for empty buffer', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('empty.bin', Buffer.alloc(0));

    const stat = await storage.stat('empty.bin');
    expect(stat).toEqual({ contentLength: 0 });
  });

  it('list returns paths under a prefix', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('dir/a.pdf', Buffer.from('a'));
    await storage.write('dir/b.html', Buffer.from('b'));
    await storage.write('other/c.txt', Buffer.from('c'));

    const entries: string[] = await storage.list('dir/');
    expect(entries.sort()).toEqual(['dir/a.pdf', 'dir/b.html']);
  });

  it('list returns empty array for prefix with no matches', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('dir/a.pdf', Buffer.from('a'));

    const entries: string[] = await storage.list('nonexistent/');
    expect(entries).toEqual([]);
  });

  it('delete removes a key', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('x.txt', Buffer.from('data'));

    await storage.delete('x.txt');

    const stat = await storage.stat('x.txt');
    expect(stat).toBeNull();
  });

  it('delete is idempotent for non-existent key', async () => {
    const storage: StorageBackend = createMemoryBackend();

    // Should not throw
    await storage.delete('never-existed');
  });

  it('rename moves data from src to dest (via copy+delete fallback)', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('old.tmp', Buffer.from('content'));

    await storage.rename('old.tmp', 'new.pdf');

    const stat = await storage.stat('old.tmp');
    expect(stat).toBeNull();

    const data: Buffer = await storage.read('new.pdf');
    expect(data.toString()).toEqual('content');
  });

  it('rename preserves exact byte content', async () => {
    const storage: StorageBackend = createMemoryBackend();
    const original: Buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    await storage.write('src.bin', original);

    await storage.rename('src.bin', 'dest.bin');

    const moved: Buffer = await storage.read('dest.bin');
    expect(moved).toEqual(original);
  });

  it('multiple keys are isolated from each other', async () => {
    const storage: StorageBackend = createMemoryBackend();
    await storage.write('a', Buffer.from('aaa'));
    await storage.write('b', Buffer.from('bbb'));

    await storage.delete('a');

    const bData: Buffer = await storage.read('b');
    expect(bData.toString()).toEqual('bbb');
    expect(await storage.stat('a')).toBeNull();
  });
});
