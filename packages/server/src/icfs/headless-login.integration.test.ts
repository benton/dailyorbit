import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { headlessLogin } from './headless-login.ts';
import { downloadFile } from '../attachments/storage.ts';
import { ConfigService } from '../lib/config-service.ts';
import { readKeyFile } from '../lib/encryption.ts';

const DB_PATH: string = resolve(
  __dirname,
  '../../../../data/daily-orbit.duckdb',
);
const KEY_PATH: string = resolve(__dirname, '../../../../data/daily-orbit.key');

/**
 * Whether the local dev environment has the DB and key file needed to
 * read ICFS credentials.  CI will not — these tests are skipped there.
 */
const canRunIntegration: boolean = existsSync(DB_PATH) && existsSync(KEY_PATH);

/** A known ICFS attachment sys_id that returns a PDF. */
const TEST_SYS_ID: string = 'ce5ab9364716a610418b674c926d43f1';
const ATTACHMENT_URL: string = `https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=${TEST_SYS_ID}`;

/**
 * Minimum cookie count that indicates a fully authenticated ServiceNow
 * session.  Unauthenticated visits yield 4-5 cookies; a real login
 * produces 8+.
 */
const MIN_AUTHENTICATED_COOKIES: number = 7;

/** PDF magic bytes: %PDF */
const PDF_MAGIC: Buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]);

describe.skipIf(!canRunIntegration)(
  'headless ICFS login → authenticated download (integration)',
  () => {
    it('logs in via headed browser, extracts 7+ cookies, and downloads a PDF attachment', async () => {
      // --- arrange: read credentials from the local DB ---
      const instance: DuckDBInstance = await DuckDBInstance.create(DB_PATH, {
        access_mode: 'READ_ONLY',
      });
      const encKey: Buffer = readKeyFile(KEY_PATH);
      const configService: ConfigService = new ConfigService(instance, encKey);
      await configService.load();

      const rawUser = configService.get('icfsUsername');
      const rawPass = configService.get('icfsPassword');
      const username: string =
        typeof rawUser === 'string' ? rawUser : rawUser.unwrap();
      const password: string =
        typeof rawPass === 'string' ? rawPass : rawPass.unwrap();

      expect(username.length).toBeGreaterThan(0);
      expect(password.length).toBeGreaterThan(0);

      // --- act: headless login ---
      const loginResult = await headlessLogin({
        username,
        password,
        headless: false,
        timeoutMs: 60_000,
        onStatus: (msg: string) => console.log(`  [login] ${msg}`),
      });

      // --- assert: login succeeded with enough cookies ---
      if (!loginResult.ok) {
        console.error(
          'Login failed:',
          loginResult.reason,
          '-',
          loginResult.message,
        );
      }
      expect(loginResult.ok).toBe(true);
      if (!loginResult.ok) return; // type narrowing

      expect(loginResult.output.cookieCount).toBeGreaterThanOrEqual(
        MIN_AUTHENTICATED_COOKIES,
      );
      expect(loginResult.output.cookies).toContain('JSESSIONID');
      expect(loginResult.output.cookies).toContain('glide_session_store');

      // --- act: download an authenticated attachment ---
      const { buffer, fileSizeBytes, contentType } = await downloadFile(
        ATTACHMENT_URL,
        { cookies: loginResult.output.cookies },
      );

      // --- assert: got a real PDF, not an HTML error page ---
      const baseContentType: string = (contentType ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      expect(baseContentType).toBe('application/pdf');
      expect(fileSizeBytes).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 4).equals(PDF_MAGIC)).toBe(true);
    }, 90_000); // generous timeout for SSO + download
  },
);
