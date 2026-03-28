#!/usr/bin/bash
# ICFS authenticated download test — proven working on EC2 2026-03-28
# Tests login via headed Playwright (Xvfb) + download via curl and Node.js fetch
#
# Usage: ./run_in_prod.sh test_icfs_auth_download.sh
set -eox pipefail

IMAGE=$(sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep daily-orbit | head -1)
echo "Using image: $IMAGE"

# Ensure service is stopped so DB is unlocked
sudo systemctl stop daily-orbit 2>/dev/null || true

TEST_SYS_ID="7a5de34e1bbb7e104911404fe54bcbda"
TEST_URL="https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=${TEST_SYS_ID}"

# Step 1: Login via CLI (headed mode — Xvfb from entrypoint)
echo "=== Step 1: Login ==="
sudo docker run --rm --network host -v /data:/app/data \
  "$IMAGE" attachments login --headed --output data/icfs-cookies.json

# Step 2: Extract cookies
echo "=== Step 2: Check cookies ==="
cat /data/icfs-cookies.json
COOKIES=$(python3 -c "import json; print(json.load(open('/data/icfs-cookies.json'))['cookies'])")
COOKIE_COUNT=$(python3 -c "import json; print(json.load(open('/data/icfs-cookies.json'))['cookieCount'])")
echo "Got $COOKIE_COUNT cookies"

# Step 3: Download with curl (no redirect follow — see raw response)
echo "=== Step 3: curl (no follow) ==="
curl -sS -D - -o /data/test-download-raw.bin \
  -H "Cookie: $COOKIES" \
  -H "User-Agent: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "Referer: https://fccprod.servicenowservices.com/icfs" \
  --max-redirs 0 \
  "$TEST_URL" 2>&1 || true

echo "--- Response body (first 500 bytes) ---"
head -c 500 /data/test-download-raw.bin
echo ""
echo "--- File size ---"
wc -c < /data/test-download-raw.bin

# Step 4: Download with curl (follow redirects)
echo "=== Step 4: curl (follow redirects) ==="
curl -sS -D - -o /data/test-download-follow.bin \
  -H "Cookie: $COOKIES" \
  -H "User-Agent: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "Referer: https://fccprod.servicenowservices.com/icfs" \
  -L \
  "$TEST_URL" 2>&1

echo "--- Content type ---"
file /data/test-download-follow.bin
echo "--- File size ---"
wc -c < /data/test-download-follow.bin
echo "--- First bytes (hex) ---"
xxd -l 16 /data/test-download-follow.bin

# Step 5: Node.js fetch inside container
echo "=== Step 5: Node.js fetch inside container ==="
cat > /data/test-download.mjs << 'NODEOF'
const cookies = process.argv[2];
const url = process.argv[3];

console.log('URL:', url);
console.log('Cookie count:', cookies.split('; ').length);

const resp = await fetch(url, {
  headers: {
    Cookie: cookies,
    'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://fccprod.servicenowservices.com/icfs',
  },
  redirect: 'follow',
});

console.log('Status:', resp.status, resp.statusText);
console.log('Content-Type:', resp.headers.get('content-type'));
console.log('Final URL:', resp.url);

const buf = await resp.arrayBuffer();
const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
if (ct === 'text/html') {
  console.log('GOT HTML:', new TextDecoder().decode(buf.slice(0, 1000)));
  console.log('*** SessionExpiredError would fire ***');
  process.exit(1);
} else {
  const hex = Buffer.from(buf.slice(0, 4)).toString('hex');
  console.log('Binary:', buf.byteLength, 'bytes, magic:', hex);
  console.log(hex === '25504446' ? 'SUCCESS: PDF' : 'Not a PDF');
}
NODEOF

sudo docker run --rm --network host \
  -v /data:/app/data \
  --entrypoint node \
  "$IMAGE" \
  /app/data/test-download.mjs "$COOKIES" "$TEST_URL"

# Cleanup
rm -f /data/test-download-raw.bin /data/test-download-follow.bin /data/test-download.mjs

echo "=== ALL TESTS PASSED ==="
