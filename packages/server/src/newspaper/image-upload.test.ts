import { describe, expect, test } from 'vitest';
import { imageS3Key } from './image-upload.ts';

describe('imageS3Key', () => {
  test('builds key for edition image', () => {
    const result: string = imageS3Key(
      'data/newspaper/images/2026-03-23/hero.webp',
    );
    expect(result).toBe('newspaper/images/2026-03-23/hero.webp');
  });

  test('builds key for library image', () => {
    const result: string = imageS3Key(
      'data/newspaper/images/library/portraits/042.webp',
    );
    expect(result).toBe('newspaper/images/library/portraits/042.webp');
  });

  test('builds key for library masthead', () => {
    const result: string = imageS3Key(
      'data/newspaper/images/library/masthead.webp',
    );
    expect(result).toBe('newspaper/images/library/masthead.webp');
  });

  test('handles absolute path from container', () => {
    const result: string = imageS3Key(
      '/app/data/newspaper/images/library/headers/foo.webp',
    );
    expect(result).toBe('newspaper/images/library/headers/foo.webp');
  });

  test('throws for path without marker', () => {
    expect(() => imageS3Key('/tmp/random.webp')).toThrow(
      "does not contain 'newspaper/images/'",
    );
  });
});
