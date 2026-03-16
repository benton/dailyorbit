import { describe, expect, it } from 'vitest';
import { gravatarUrl } from './gravatar.ts';

describe('gravatarUrl', () => {
  // Known MD5: md5("test@example.com") = 55502f40dc8b7c769880b10874abc9d0
  const KNOWN_EMAIL: string = 'test@example.com';
  const KNOWN_HASH: string = '55502f40dc8b7c769880b10874abc9d0';

  it('generates correct gravatar URL for a known email', () => {
    const url: string = gravatarUrl(KNOWN_EMAIL);
    expect(url).toEqual(
      `https://www.gravatar.com/avatar/${KNOWN_HASH}?d=identicon&s=80`,
    );
  });

  it('trims whitespace from email', () => {
    const url: string = gravatarUrl('  test@example.com  ');
    expect(url).toContain(KNOWN_HASH);
  });

  it('lowercases email before hashing', () => {
    const url: string = gravatarUrl('TEST@EXAMPLE.COM');
    expect(url).toContain(KNOWN_HASH);
  });

  it('respects custom size parameter', () => {
    const url: string = gravatarUrl(KNOWN_EMAIL, 128);
    expect(url).toEqual(
      `https://www.gravatar.com/avatar/${KNOWN_HASH}?d=identicon&s=128`,
    );
  });
});
