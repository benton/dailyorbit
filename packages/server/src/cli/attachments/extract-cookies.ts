import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cookie } from 'playwright';
import { defineCommand } from 'citty';
import { getLogger } from '../../lib/logger.ts';
import { resolveFromRoot } from '../shared/context.ts';
import {
  formatCookieOutput,
  type CookieOutput,
} from '../../icfs/headless-login.ts';

const ICFS_URL: string = 'https://fccprod.servicenowservices.com/icfs';
const SERVICENOW_DOMAIN: string = 'fccprod.servicenowservices.com';

export const extractCookiesCommand = defineCommand({
  meta: {
    name: 'extract-cookies',
    description:
      'Extract ServiceNow session cookies for authenticated downloads',
  },
  args: {
    output: {
      type: 'string',
      description: 'Output path for cookies JSON file',
      default: 'data/icfs-cookies.json',
    },
  },
  async run({ args }) {
    const log = getLogger();
    const outputPath: string = resolveFromRoot(args.output);

    // Dynamic import — Playwright is a devDependency, not available in production
    let chromium: typeof import('playwright').chromium;
    try {
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch {
      log.error(
        'Playwright is not installed. Run: pnpx playwright install chromium',
      );
      process.exit(1);
    }

    log.info(
      'Launching browser — log in to ICFS, then press Enter here to extract cookies.\n',
    );

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(ICFS_URL);

    // Wait for the user to press Enter after completing login
    await new Promise<void>((resolve) => {
      process.stdout.write('Press Enter after you have logged in... ');
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        process.stdin.unref();
        resolve();
      });
    });

    const allCookies: Cookie[] = await context.cookies(
      `https://${SERVICENOW_DOMAIN}`,
    );
    await browser.close();

    let output: CookieOutput;
    try {
      output = formatCookieOutput(allCookies, new Date());
    } catch {
      log.error('No ServiceNow cookies found. Did you complete login?');
      process.exit(1);
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

    // Print individual cookie details
    const snCookies: Cookie[] = allCookies.filter((c: Cookie) =>
      c.domain.includes(SERVICENOW_DOMAIN),
    );
    log.info(`\nExtracted ${String(snCookies.length)} cookies:`);
    for (const c of snCookies) {
      const expiry: string =
        c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session';
      log.info(`  ${c.name} (expires: ${expiry})`);
    }
    log.info(`\nWritten to ${outputPath}`);
    log.info(`Estimated expiry: ${output.expiresAt}`);
  },
});
