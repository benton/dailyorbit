import type { Cookie } from 'playwright';

const ICFS_URL: string = 'https://fccprod.servicenowservices.com/icfs';
const SERVICENOW_DOMAIN: string = 'fccprod.servicenowservices.com';
const SESSION_LIFETIME_MS: number = 30 * 60 * 1000;
const OKTA_DOMAIN: string = 'fcc-ext.okta.com';

export type CookieOutput = {
  cookies: string;
  extractedAt: string;
  expiresAt: string;
  cookieCount: number;
};

export type HeadlessLoginOptions = {
  username: string;
  password: string;
  headless?: boolean;
  timeoutMs?: number;
  onStatus?: (msg: string) => void;
};

export type HeadlessLoginResult =
  | { ok: true; output: CookieOutput }
  | {
      ok: false;
      reason: 'playwright_missing' | 'tfa_required' | 'login_failed';
      message: string;
    };

/**
 * Format raw Playwright cookies into the CookieOutput JSON structure.
 */
export function formatCookieOutput(cookies: Cookie[], now: Date): CookieOutput {
  const snCookies: Cookie[] = cookies.filter((c: Cookie) =>
    c.domain.includes(SERVICENOW_DOMAIN),
  );
  if (snCookies.length === 0) {
    throw new Error('No ServiceNow cookies found after login');
  }
  return {
    cookies: snCookies.map((c: Cookie) => `${c.name}=${c.value}`).join('; '),
    extractedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
    cookieCount: snCookies.length,
  };
}

/**
 * Run a headless (or headed) Playwright login against ICFS/Okta,
 * returning session cookies on success.
 */
export async function headlessLogin(
  options: HeadlessLoginOptions,
): Promise<HeadlessLoginResult> {
  const {
    username,
    password,
    headless = true,
    timeoutMs = 60_000,
    onStatus,
  } = options;
  const log: (msg: string) => void = onStatus ?? (() => {});

  // Dynamic import — Playwright is a devDependency
  let chromium: typeof import('playwright').chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    return {
      ok: false,
      reason: 'playwright_missing',
      message:
        'Playwright is not installed. Run: pnpx playwright install chromium',
    };
  }

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    log('Navigating to ICFS...');
    await page.goto(ICFS_URL, { waitUntil: 'networkidle', timeout: timeoutMs });

    // Expect redirect to Okta login page
    const url: string = page.url();
    if (!url.includes(OKTA_DOMAIN)) {
      // Already logged in (cookies still valid?) or unexpected page
      if (url.includes(SERVICENOW_DOMAIN)) {
        log('Already authenticated — extracting cookies');
        const allCookies: Cookie[] = await context.cookies(
          `https://${SERVICENOW_DOMAIN}`,
        );
        return { ok: true, output: formatCookieOutput(allCookies, new Date()) };
      }
      return {
        ok: false,
        reason: 'login_failed',
        message: `Unexpected URL after navigation: ${url}`,
      };
    }

    // Fill Okta login form
    log('Filling Okta credentials...');
    await page.fill(
      'input[name="identifier"], input#okta-signin-username',
      username,
    );
    await page.click('input[type="submit"], button[type="submit"]');

    // Wait for password field (Okta uses a two-step form)
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await page.fill('input[type="password"]', password);
    await page.click('input[type="submit"], button[type="submit"]');

    // Wait for redirect back to ServiceNow OR a 2FA challenge
    log('Waiting for redirect...');
    try {
      await page.waitForURL(`https://${SERVICENOW_DOMAIN}/**`, {
        timeout: 15_000,
      });
    } catch {
      // Check if we landed on a 2FA / MFA challenge page
      const currentUrl: string = page.url();
      if (currentUrl.includes(OKTA_DOMAIN)) {
        // Still on Okta — likely 2FA required
        await browser.close();
        return {
          ok: false,
          reason: 'tfa_required',
          message:
            'Two-factor authentication required. Use ./daily-orbit attachments extract-cookies for manual login.',
        };
      }
      return {
        ok: false,
        reason: 'login_failed',
        message: `Login timed out. Current URL: ${currentUrl}`,
      };
    }

    // Extract cookies
    log('Login successful — extracting cookies');
    const allCookies: Cookie[] = await context.cookies(
      `https://${SERVICENOW_DOMAIN}`,
    );
    return { ok: true, output: formatCookieOutput(allCookies, new Date()) };
  } finally {
    await browser.close();
  }
}
