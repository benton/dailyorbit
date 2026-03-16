import { createHash } from 'node:crypto';

export function gravatarUrl(email: string, size: number = 80): string {
  const hash: string = createHash('md5')
    .update(email.trim().toLowerCase())
    .digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${String(size)}`;
}
