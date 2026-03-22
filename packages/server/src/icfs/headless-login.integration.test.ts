import { describe, expect, it } from 'vitest';
import { headlessLogin } from './headless-login.ts';

describe('headless ICFS login (integration)', () => {
  it.skipIf(!process.env.ICFS_USERNAME)(
    'completes login and extracts cookies',
    async () => {
      const result = await headlessLogin({
        username: process.env.ICFS_USERNAME!,
        password: process.env.ICFS_PASSWORD!,
        headless: true,
        onStatus: console.log,
      });

      if (result.ok) {
        expect(result.output.cookieCount).toBeGreaterThanOrEqual(4);
        expect(result.output.cookies).toContain('JSESSIONID');
      } else {
        // 2FA required is acceptable — means login reached Okta successfully
        expect(result.reason).toBe('tfa_required');
      }
    },
    60_000,
  );
});
