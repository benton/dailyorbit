import { describe, expect, it } from 'vitest';
import { createStorageFromConfig } from './create-storage.ts';
import type { StorageBackend } from './storage-backend.ts';

function fakeConfig(overrides: Record<string, string> = {}): {
  get(key: string): unknown;
} {
  const defaults: Record<string, string> = {
    storageBackend: 'fs',
    storageFsRoot: '/tmp/test-storage',
    storageBucket: '',
    storageRegion: 'us-east-2',
    storagePrefix: 'attachments/',
  };
  const merged: Record<string, string> = { ...defaults, ...overrides };
  return { get: (key: string): unknown => merged[key] };
}

describe('createStorageFromConfig', () => {
  it('returns a StorageBackend with all required methods for fs backend', () => {
    const storage: StorageBackend = createStorageFromConfig(fakeConfig());

    expect(typeof storage.write).toEqual('function');
    expect(typeof storage.read).toEqual('function');
    expect(typeof storage.stat).toEqual('function');
    expect(typeof storage.list).toEqual('function');
    expect(typeof storage.delete).toEqual('function');
    expect(typeof storage.rename).toEqual('function');
  });

  it('defaults to fs backend when storageBackend is not set', () => {
    const config = { get: (): unknown => undefined };
    const storage: StorageBackend = createStorageFromConfig(config);

    // Should not throw — fs backend is the default
    expect(typeof storage.read).toEqual('function');
  });

  it('throws when s3 backend is selected but bucket is missing', () => {
    const config = fakeConfig({ storageBackend: 's3', storageBucket: '' });

    expect(() => createStorageFromConfig(config)).toThrow(
      'storageBackend is "s3" but storageBucket is not configured',
    );
  });

  it('returns a StorageBackend for s3 backend when bucket is provided', () => {
    const config = fakeConfig({
      storageBackend: 's3',
      storageBucket: 'my-bucket',
      storageRegion: 'us-west-1',
      storagePrefix: 'data/',
    });
    const storage: StorageBackend = createStorageFromConfig(config);

    expect(typeof storage.read).toEqual('function');
  });
});
