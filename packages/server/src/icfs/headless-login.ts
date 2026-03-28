import type { Cookie } from 'playwright';

const SERVICENOW_DOMAIN: string = 'fccprod.servicenowservices.com';
const SESSION_LIFETIME_MS: number = 30 * 60 * 1000;
const OKTA_DOMAIN: string = 'fcc-ext.okta.com';

/**
 * URL that triggers Okta SSO login.  The public /icfs portal loads without
 * auth, so navigating there never triggers login.  We use login_with_sso.do
 * with the FCC external SSO glide_sso_id, which redirects directly to the
 * Okta IdP (fcc-ext.okta.com) — skipping the intermediate FCC portal page.
 */
const SSO_ID: string = '10db4616dbb07200f2f2f6531f9619de';
const LOGIN_URL: string = `https://${SERVICENOW_DOMAIN}/login_with_sso.do?glide_sso_id=${SSO_ID}`;

/**
 * Minimum number of ServiceNow cookies that indicate a fully initialized
 * platform session.  A fresh unauthenticated visit yields ~4 cookies;
 * a real login produces 8+.
 */
const MIN_AUTHENTICATED_COOKIES: number = 7;

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
 * Wait for the ServiceNow platform session to fully initialize.
 * After the SAML redirect, ServiceNow sets additional cookies
 * (glide_session_store, glide_user_activity, etc.) via page JS.
 * We poll until we see enough cookies or timeout.
 */
async function waitForSessionCookies(
  context: import('playwright').BrowserContext,
  timeoutMs: number,
): Promise<Cookie[]> {
  const deadline: number = Date.now() + timeoutMs;
  let cookies: Cookie[] = [];
  while (Date.now() < deadline) {
    cookies = await context.cookies(`https://${SERVICENOW_DOMAIN}`);
    const snCount: number = cookies.filter((c: Cookie) =>
      c.domain.includes(SERVICENOW_DOMAIN),
    ).length;
    if (snCount >= MIN_AUTHENTICATED_COOKIES) {
      return cookies;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return cookies;
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

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    // Remove Playwright's automation indicators
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    // Navigate to the SSO login URL.  This redirects through Okta and
    // back to ServiceNow.  If Okta has a cached SSO session, it may
    // redirect back without showing the login form.
    log('Navigating to ICFS...');
    await page.goto(LOGIN_URL, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });

    const url: string = page.url();
    log(`After navigation: ${url}`);

    if (url.includes(SERVICENOW_DOMAIN)) {
      // Okta had a cached SSO session and redirected back immediately.
      // Wait for the ServiceNow session to fully initialize.
      log('SSO session cached — waiting for ServiceNow session...');
      const allCookies: Cookie[] = await waitForSessionCookies(context, 10_000);
      const snCount: number = allCookies.filter((c) =>
        c.domain.includes(SERVICENOW_DOMAIN),
      ).length;

      if (snCount >= MIN_AUTHENTICATED_COOKIES) {
        log(`Authenticated — ${String(snCount)} cookies`);
        return { ok: true, output: formatCookieOutput(allCookies, new Date()) };
      }

      // Not enough cookies — the "redirect back" was to the unauthenticated
      // nav page, not a real SSO completion.  Clear cookies and retry.
      log(
        `Only ${String(snCount)} cookies — not authenticated, retrying login...`,
      );
      await context.clearCookies();
      await page.goto(LOGIN_URL, {
        waitUntil: 'networkidle',
        timeout: timeoutMs,
      });
      const retryUrl: string = page.url();
      if (!retryUrl.includes(OKTA_DOMAIN)) {
        return {
          ok: false,
          reason: 'login_failed',
          message: `Expected Okta after retry, got: ${retryUrl}`,
        };
      }
    }

    // At this point we should be on Okta
    if (!page.url().includes(OKTA_DOMAIN)) {
      return {
        ok: false,
        reason: 'login_failed',
        message: `Expected Okta, got: ${page.url()}`,
      };
    }

    // Fill Okta login form — wait for the embedded widget to render
    log('Filling Okta credentials...');
    await page.waitForSelector(
      'input[name="identifier"], input#okta-signin-username',
      { timeout: 15_000 },
    );

    // Detect whether Okta shows a single-step or two-step form.
    // Some Okta configs show both username + password at once; others
    // show username first, then password after the first submit.
    const passwordAlreadyVisible: boolean = await page
      .locator('input[type="password"]')
      .count()
      .then((n: number) => n > 0);

    if (passwordAlreadyVisible) {
      // Single-step form: fill both fields, submit once
      log('Okta single-step form detected');
      await page.fill(
        'input[name="identifier"], input#okta-signin-username',
        username,
      );
      await page.fill('input[type="password"]', password);
      await page.click('input[type="submit"], button[type="submit"]');
    } else {
      // Two-step form: submit username first, then password
      log('Okta two-step form detected');
      await page.fill(
        'input[name="identifier"], input#okta-signin-username',
        username,
      );
      await page.click('input[type="submit"], button[type="submit"]');
      await page.waitForSelector('input[type="password"]', {
        timeout: 10_000,
      });
      await page.fill('input[type="password"]', password);
      await page.click('input[type="submit"], button[type="submit"]');
    }

    // Wait for redirect back to ServiceNow OR a 2FA challenge
    log('Waiting for redirect...');
    try {
      await page.waitForURL(`https://${SERVICENOW_DOMAIN}/**`, {
        timeout: 30_000,
      });
    } catch {
      // Redirect to ServiceNow didn't happen — diagnose the failure
      const currentUrl: string = page.url();
      const pageTitle: string = await page.title();
      log(`Redirect timed out. URL: ${currentUrl}, title: ${pageTitle}`);

      // Capture screenshot for diagnostics
      const screenshotPath: string = '/tmp/icfs-login-failure.png';
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log(`Screenshot saved to ${screenshotPath}`);
      } catch {
        log('Failed to capture screenshot');
      }

      if (currentUrl.includes(OKTA_DOMAIN)) {
        // Check for Okta form validation errors (wrong credentials)
        const hasFormError: boolean = await page
          .locator(
            '.okta-form-infobox-error, .o-form-error-container, [data-se="o-form-error-container"]',
          )
          .count()
          .then((n: number) => n > 0);

        if (hasFormError) {
          const errorText: string = await page
            .locator(
              '.okta-form-infobox-error, .o-form-error-container, [data-se="o-form-error-container"]',
            )
            .first()
            .innerText()
            .catch(() => 'unknown error');
          await browser.close();
          return {
            ok: false,
            reason: 'login_failed',
            message: `Okta credential error: ${errorText.slice(0, 200)}. Screenshot: ${screenshotPath}`,
          };
        }

        // Check for real 2FA / MFA challenge inputs
        const has2faInput: boolean = await page
          .locator('input[name="credentials.passcode"], input[name="answer"]')
          .count()
          .then((n: number) => n > 0);

        if (has2faInput) {
          await browser.close();
          return {
            ok: false,
            reason: 'tfa_required',
            message: `Two-factor authentication required. Screenshot: ${screenshotPath}`,
          };
        }

        // No 2FA input and no form error — stalled redirect or unknown page
        const bodyText: string = await page
          .locator('body')
          .innerText()
          .catch(() => '');
        await browser.close();
        return {
          ok: false,
          reason: 'login_failed',
          message: `Redirect stalled on Okta. Title: ${pageTitle}. Body snippet: ${bodyText.slice(0, 200)}. Screenshot: ${screenshotPath}`,
        };
      }
      return {
        ok: false,
        reason: 'login_failed',
        message: `Login timed out. URL: ${currentUrl}, title: ${pageTitle}. Screenshot: ${screenshotPath}`,
      };
    }

    // Wait for the ServiceNow platform session to fully initialize.
    // The SAML redirect lands on navpage.do, which runs JS that sets
    // additional session cookies (glide_session_store, etc.).
    log('Login successful — waiting for session initialization...');
    const allCookies: Cookie[] = await waitForSessionCookies(context, 10_000);
    const output: CookieOutput = formatCookieOutput(allCookies, new Date());
    log(`Extracted ${String(output.cookieCount)} cookies`);
    return { ok: true, output };
  } finally {
    await browser.close();
  }
}
