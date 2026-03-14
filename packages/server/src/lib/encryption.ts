import { readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_LENGTH_BYTES: number = 32; // 256-bit

/** Generate a new random encryption key and write it to the given path. */
export function generateKeyFile(keyFilePath: string): Buffer {
  const key: Buffer = randomBytes(KEY_LENGTH_BYTES);
  writeFileSync(keyFilePath, key.toString('base64') + '\n', {
    mode: 0o600,
  });
  return key;
}

/** Read an existing encryption key from a file. */
export function readKeyFile(keyFilePath: string): Buffer {
  const content: string = readFileSync(keyFilePath, 'utf-8').trim();
  return Buffer.from(content, 'base64');
}

const IV_LENGTH_BYTES: number = 12;
const AUTH_TAG_LENGTH_BYTES: number = 16;

/** Encrypt plaintext using AES-256-GCM. Returns base64(iv || authTag || ciphertext). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv: Buffer = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted: Buffer = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag: Buffer = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/** Decrypt a base64(iv || authTag || ciphertext) string using AES-256-GCM. */
export function decrypt(ciphertext: string, key: Buffer): string {
  const data: Buffer = Buffer.from(ciphertext, 'base64');
  const iv: Buffer = data.subarray(0, IV_LENGTH_BYTES);
  const authTag: Buffer = data.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const encrypted: Buffer = data.subarray(
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf-8',
  );
}

/**
 * Wraps a secret string to prevent accidental logging.
 * Use .unwrap() to get the plaintext — all serialization methods return '[ENCRYPTED]'.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Get the plaintext secret value. */
  unwrap(): string {
    return this.#value;
  }

  toString(): string {
    return '[ENCRYPTED]';
  }

  toJSON(): string {
    return '[ENCRYPTED]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[ENCRYPTED]';
  }
}
