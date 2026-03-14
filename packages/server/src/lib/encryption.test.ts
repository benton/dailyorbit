import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretValue, decrypt, encrypt } from './encryption.ts';

const TEST_KEY: Buffer = randomBytes(32);

describe('encrypt / decrypt', () => {
  it('round-trips arbitrary plaintext', () => {
    const plaintext: string = 'my-secret-auth-token-12345';
    const ciphertext: string = encrypt(plaintext, TEST_KEY);
    const recovered: string = decrypt(ciphertext, TEST_KEY);
    expect(recovered).toEqual(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext: string = 'same-input';
    const a: string = encrypt(plaintext, TEST_KEY);
    const b: string = encrypt(plaintext, TEST_KEY);
    expect(a).not.toEqual(b);
  });

  it('round-trips empty string', () => {
    const ciphertext: string = encrypt('', TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toEqual('');
  });

  it('round-trips unicode content', () => {
    const plaintext: string = '🛰️ satellite données 日本語';
    const ciphertext: string = encrypt(plaintext, TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toEqual(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext: string = encrypt('secret', TEST_KEY);
    const tampered: Buffer = Buffer.from(ciphertext, 'base64');
    const lastIdx: number = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0xff;
    expect(() => decrypt(tampered.toString('base64'), TEST_KEY)).toThrow();
  });

  it('throws with wrong key', () => {
    const wrongKey: Buffer = randomBytes(32);
    const ciphertext: string = encrypt('secret', TEST_KEY);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});

describe('SecretValue', () => {
  const secret: SecretValue = new SecretValue('hunter2');

  it('unwrap() returns the plaintext', () => {
    expect(secret.unwrap()).toEqual('hunter2');
  });

  it('toString() masks the value', () => {
    expect(secret.toString()).toEqual('[ENCRYPTED]');
  });

  it('template literal interpolation masks the value', () => {
    expect(`secret is ${secret}`).toEqual('secret is [ENCRYPTED]');
  });

  it('toJSON() masks the value', () => {
    expect(JSON.stringify({ s: secret })).toEqual('{"s":"[ENCRYPTED]"}');
  });

  it('util.inspect masks the value', () => {
    const { inspect } = require('node:util');
    expect(inspect(secret)).toEqual('[ENCRYPTED]');
  });
});
