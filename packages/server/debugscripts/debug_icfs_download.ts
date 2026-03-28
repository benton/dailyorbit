#!/usr/bin/env node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm

/**
 * Debug script: test a single authenticated ICFS download and log
 * the full response (status, headers, content-type, body preview).
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { ConfigService } from '../src/lib/config-service.ts';
import { readKeyFile } from '../src/lib/encryption.ts';
import { headlessLogin } from '../src/icfs/headless-login.ts';

const DB_PATH: string = resolve(__dirname, '../../../data/daily-orbit.duckdb');
const KEY_PATH: string = resolve(__dirname, '../../../data/daily-orbit.key');

// Known test attachment
const TEST_SYS_ID: string = 'ce5ab9364716a610418b674c926d43f1';
const ATTACHMENT_URL: string = `https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=${TEST_SYS_ID}`;

const BROWSER_USER_AGENT: string =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function main(): Promise<void> {
  if (!existsSync(DB_PATH) || !existsSync(KEY_PATH)) {
    console.error('Missing DB or key file');
    process.exit(1);
  }

  // 1. Read credentials
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

  // 2. Login
  console.log('=== Headless Login ===');
  const loginResult = await headlessLogin({
    username,
    password,
    headless: false,
    timeoutMs: 60_000,
    onStatus: (msg: string) => console.log(`  [login] ${msg}`),
  });

  if (!loginResult.ok) {
    console.error(
      'Login failed:',
      loginResult.reason,
      '-',
      loginResult.message,
    );
    process.exit(1);
  }

  const { cookies, cookieCount } = loginResult.output;
  console.log(`Login OK — ${cookieCount} cookies`);
  console.log(
    'Cookie names:',
    cookies
      .split('; ')
      .map((c) => c.split('=')[0])
      .join(', '),
  );

  // 3. Test download — NO redirect follow, to see what ServiceNow returns
  console.log('\n=== Download Test (no redirect follow) ===');
  console.log(`URL: ${ATTACHMENT_URL}`);

  const noFollowResp: Response = await fetch(ATTACHMENT_URL, {
    headers: {
      Cookie: cookies,
      'User-Agent': BROWSER_USER_AGENT,
      Referer: 'https://fccprod.servicenowservices.com/icfs',
    },
    redirect: 'manual',
  });

  console.log(`Status: ${noFollowResp.status} ${noFollowResp.statusText}`);
  console.log('Headers:');
  noFollowResp.headers.forEach((value: string, key: string) => {
    console.log(`  ${key}: ${value}`);
  });

  if (noFollowResp.status >= 300 && noFollowResp.status < 400) {
    const location: string | null = noFollowResp.headers.get('location');
    console.log(`\nRedirect to: ${location}`);
  }

  const noFollowBody: ArrayBuffer = await noFollowResp.arrayBuffer();
  const noFollowText: string = new TextDecoder().decode(
    noFollowBody.slice(0, 2000),
  );
  console.log(`\nBody (first 2000 chars):\n${noFollowText}`);

  // 4. Test download — WITH redirect follow
  console.log('\n=== Download Test (follow redirects) ===');
  const followResp: Response = await fetch(ATTACHMENT_URL, {
    headers: {
      Cookie: cookies,
      'User-Agent': BROWSER_USER_AGENT,
      Referer: 'https://fccprod.servicenowservices.com/icfs',
    },
    redirect: 'follow',
  });

  console.log(`Status: ${followResp.status} ${followResp.statusText}`);
  console.log(`Content-Type: ${followResp.headers.get('content-type')}`);
  console.log(`Content-Length: ${followResp.headers.get('content-length')}`);
  console.log(`Final URL: ${followResp.url}`);

  const followBody: ArrayBuffer = await followResp.arrayBuffer();
  const contentType: string = (followResp.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();

  if (contentType === 'text/html') {
    const htmlText: string = new TextDecoder().decode(
      followBody.slice(0, 2000),
    );
    console.log(`\nGot HTML! Body (first 2000 chars):\n${htmlText}`);
    console.log('\n*** This is what triggers SessionExpiredError ***');
  } else {
    const hex: string = Buffer.from(followBody.slice(0, 16)).toString('hex');
    console.log(`\nGot binary content (${followBody.byteLength} bytes)`);
    console.log(`First 16 bytes (hex): ${hex}`);
    if (hex.startsWith('25504446')) {
      console.log('Looks like a valid PDF!');
    }
  }

  await instance.closeSync();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
