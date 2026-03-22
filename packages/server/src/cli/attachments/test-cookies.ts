import { readFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import { resolveFromRoot } from '../shared/context.ts';
import type { CookieOutput } from '../../icfs/headless-login.ts';

const TEST_URL: string = 'https://fccprod.servicenowservices.com/icfs';

export const testCookiesCommand = defineCommand({
  meta: {
    name: 'test-cookies',
    description: 'Verify that cached ICFS session cookies are still valid',
  },
  args: {
    input: {
      type: 'string',
      description: 'Path to cookies JSON file',
      default: 'data/icfs-cookies.json',
    },
  },
  async run({ args }) {
    const cookiePath: string = resolveFromRoot(args.input);
    const raw: CookieOutput = JSON.parse(readFileSync(cookiePath, 'utf-8'));

    const expiresAt: Date = new Date(raw.expiresAt);
    const now: Date = new Date();
    if (now > expiresAt) {
      console.log(
        `Cookies expired at ${raw.expiresAt} (${String(Math.round((now.getTime() - expiresAt.getTime()) / 60_000))} min ago)`,
      );
    } else {
      console.log(
        `Cookies extracted at ${raw.extractedAt}, estimated expiry: ${raw.expiresAt}`,
      );
    }

    console.log(`Testing session with ${String(raw.cookieCount)} cookies...`);

    const response: Response = await fetch(TEST_URL, {
      headers: { Cookie: raw.cookies },
      redirect: 'manual',
    });

    if (response.status === 200) {
      console.log('Session is ACTIVE (HTTP 200)');
    } else if (response.status === 301 || response.status === 302) {
      const location: string = response.headers.get('location') ?? '(none)';
      console.log(
        `Session is EXPIRED (HTTP ${String(response.status)} -> ${location})`,
      );
      process.exit(1);
    } else {
      console.log(`Unexpected status: ${String(response.status)}`);
      process.exit(1);
    }
  },
});
