# Plan: Bulletproof ICFS Pipeline Download with Exhaustive Logging

## Context

After 4 hours of debugging, we've proven that ICFS authenticated downloads work perfectly on EC2 via `test_icfs_auth_download.sh` (login → curl → Node.js fetch = PDF every time). But the pipeline (`runAttachmentPipeline`) fails instantly with `SessionExpiredError` using the **exact same cookies**.

The working test script is our ground truth. This plan integrates every line of that script into the pipeline's download path, with logging after literally every step, so the failing point becomes unmistakable.

## Strategy: "Canary Download" Before Queue

Before processing the full 60k queue, the pipeline will attempt a single "canary" download using the **exact same raw `fetch()` pattern** as the working test script. This isolates whether the issue is in the download code or in the queue/URL selection.

## Files to Modify

1. `packages/server/src/attachments/pipeline.ts` — Add canary download before queue
2. `packages/server/src/attachments/storage.ts` — Add `canaryDownload()`, revert DOWNLOAD_VERBOSE logging
3. `packages/server/src/attachments/fetch-retry.ts` — Revert DOWNLOAD_VERBOSE logging
4. `packages/server/debugscripts/debug_ec2_instance.sh` — Update to run pipeline cleanly

## Steps

### Step 1: Add `canaryDownload()` to `storage.ts`

Add a new function that reproduces the working test script's Node.js fetch (Step 5 from `test_icfs_auth_download.sh`) **line for line**, with a `console.error` log after every single operation:

```typescript
export async function canaryDownload(
  url: string,
  cookies: string,
  log: (msg: string) => void,
): Promise<boolean> {
  // Mirror test_icfs_auth_download.sh Step 5 exactly
  log(`[canary] url=${url}`);
  log(`[canary] cookie count=${String(cookies.split('; ').length)}`);
  log(`[canary] cookie length=${String(cookies.length)}`);
  log(`[canary] cookie first 50 chars=${cookies.slice(0, 50)}`);

  const headers = {
    Cookie: cookies,
    'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://fccprod.servicenowservices.com/icfs',
  };
  log(`[canary] headers=${JSON.stringify(Object.keys(headers))}`);

  log('[canary] calling fetch() with redirect: follow ...');
  const resp = await fetch(url, { headers, redirect: 'follow' });

  log(`[canary] status=${String(resp.status)} ${resp.statusText}`);
  log(`[canary] content-type=${resp.headers.get('content-type')}`);
  log(`[canary] final url=${resp.url}`);
  log(`[canary] redirected=${String(resp.redirected)}`);

  const buf = await resp.arrayBuffer();
  log(`[canary] body size=${String(buf.byteLength)}`);

  const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'text/html') {
    const preview = new TextDecoder().decode(buf.slice(0, 1000));
    log(`[canary] FAIL: got text/html — body preview: ${preview}`);
    return false;
  }

  const hex = Buffer.from(buf.slice(0, 4)).toString('hex');
  log(`[canary] binary: ${String(buf.byteLength)} bytes, magic: ${hex}`);
  log(`[canary] ${hex === '25504446' ? 'SUCCESS: PDF' : 'SUCCESS: non-PDF binary'}`);
  return true;
}
```

Key: This is the **exact same logic** as the test script's Step 5 `test-download.mjs`, not the pipeline's `downloadFile()` → `fetchWithRetry()` chain.

### Step 2: Insert canary into pipeline download phase

In `pipeline.ts`, after the skipExisting reconciliation but BEFORE `processQueue`, add:

```typescript
// ── Canary download: test first URL with raw fetch (same as test_icfs_auth_download.sh) ──
if (isAuthenticated && toDownload.length > 0) {
  const canaryAtt = toDownload[0]!;
  log(`=== CANARY DOWNLOAD: testing ${canaryAtt.downloadUrl} ===`);

  const canaryOk = await canaryDownload(canaryAtt.downloadUrl, options.authCookies!, log);

  if (!canaryOk) {
    log('=== CANARY FAILED with raw fetch() — cookies may be invalid ===');
    log('=== Now testing with downloadFile() for comparison ===');
    try {
      const result = await downloadFile(canaryAtt.downloadUrl, { cookies: options.authCookies });
      log(`=== downloadFile() SUCCEEDED: ${String(result.fileSizeBytes)} bytes, ${result.contentType} ===`);
    } catch (e) {
      log(`=== downloadFile() ALSO FAILED: ${e instanceof Error ? e.message : String(e)} ===`);
    }
    sessionExpired = true;
  } else {
    log('=== CANARY PASSED — verifying downloadFile() path matches ===');
    try {
      const result = await downloadFile(canaryAtt.downloadUrl, { cookies: options.authCookies });
      log(`=== downloadFile() also OK: ${String(result.fileSizeBytes)} bytes, ${result.contentType} ===`);
    } catch (e) {
      log(`=== downloadFile() FAILED despite canary passing: ${e instanceof Error ? e.message : String(e)} ===`);
      log('=== BUG IS IN downloadFile/fetchWithRetry PATH ===');
      sessionExpired = true;
    }
  }
}
```

This gives us 4 possible outcomes:

| Canary (raw fetch) | downloadFile() | Diagnosis |
|---|---|---|
| PASS | PASS | Cookies work, URLs work — bug is in queue or later |
| PASS | FAIL | **Bug is in fetchWithRetry or downloadFile wrapper** |
| FAIL | FAIL | Cookies invalid or first URL is bad |
| FAIL | PASS | Impossible (same URL + cookies) |

### Step 3: Revert DOWNLOAD_VERBOSE env var logging

Remove the `process.env.DOWNLOAD_VERBOSE` conditional logging from `storage.ts` and `fetch-retry.ts` — the canary provides all diagnostics without polluting every download. Keep only the `SESSION EXPIRED` body preview log in `storage.ts` (always useful).

### Step 4: Update debug script

```bash
#!/usr/bin/bash
set -eox pipefail
IMAGE=$(sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep daily-orbit | head -1)
echo "Using image: $IMAGE"
sudo docker kill $(sudo docker ps -q) 2>/dev/null || true
sudo systemctl stop daily-orbit 2>/dev/null || true
sleep 2

echo "=== Running pipeline with canary download ==="
sudo docker run --rm --network host -v /data:/app/data \
  -e NODE_ENV=production \
  "$IMAGE" attachments download --concurrency 1 --verbose \
  --auth-cookies data/icfs-cookies.json 2>&1

echo "=== DONE ==="
```

### Step 5: Hot-deploy and run

1. `./deploy/hot-deploy.sh`
2. `run_in_prod.sh debug_ec2_instance.sh`
3. Read the canary output — it will tell us EXACTLY what's different

### Step 6: Fix the root cause (based on canary results)

- **Canary PASS + downloadFile FAIL** → Bug is in `fetchWithRetry` wrapping (headers, redirect, retry behavior)
- **Canary FAIL** → First URL in queue is bad (not `sys_attachment.do`), or cookies from CLI JSON are malformed
- **Both PASS** → Bug is in `processQueue` invocation, abort controller, or something else in the queue machinery

### Step 7: Restart production service

After debugging: `ssh ubuntu@api.dailyorbit.org 'sudo systemctl start daily-orbit'`

## Verification

1. Run `test_icfs_auth_download.sh` first to confirm login + cookies still valid
2. Run `debug_ec2_instance.sh` with canary build
3. Canary output reveals exactly where pipeline diverges from working test
4. Fix root cause, verify downloads proceed past item 0
