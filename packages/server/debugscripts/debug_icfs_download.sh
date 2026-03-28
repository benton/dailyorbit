#!/usr/bin/bash
# Debug ICFS download behavior — test what ServiceNow returns for authenticated requests
set -eox pipefail

echo "=== ICFS Download Debug: $(date -u) ==="

# Get a sample pending download URL from the DB
echo "--- Copying DB for query ---"
cp -p /data/daily-orbit.duckdb /tmp/debug-query.duckdb

echo "--- Sample pending ServiceNow URLs ---"
duckdb /tmp/debug-query.duckdb -json "
  SELECT attachment_key, download_url
  FROM attachment
  WHERE download_status = 'pending'
    AND download_url LIKE '%servicenowservices.com%'
  LIMIT 3
"

SAMPLE_URL=$(duckdb /tmp/debug-query.duckdb -noheader -list "
  SELECT download_url
  FROM attachment
  WHERE download_status = 'pending'
    AND download_url LIKE '%servicenowservices.com%'
  LIMIT 1
")

echo "--- Testing URL without cookies (expect 302) ---"
curl -sS -o /dev/null -w "HTTP %{http_code} redirect=%{redirect_url} size=%{size_download}\n" \
  -D /tmp/icfs-noauth-headers.txt \
  --max-redirs 0 \
  "$SAMPLE_URL" || true
echo "Response headers:"
cat /tmp/icfs-noauth-headers.txt

echo "--- Testing URL with cookies from last login ---"
# Get cookies by running a quick headless login via the app's CLI
# First check if there's a cached cookie from the container environment
echo "--- Checking if Playwright browser is available ---"
npx playwright --version 2>&1 || echo "Playwright not available"

echo "--- Testing with verbose curl (follow redirects, show chain) ---"
curl -sS -o /tmp/icfs-response.txt -w "HTTP %{http_code} content_type=%{content_type} size=%{size_download}\n" \
  -L --max-redirs 5 \
  "$SAMPLE_URL" || true
echo "Response body (first 500 chars):"
head -c 500 /tmp/icfs-response.txt

echo "--- Checking server's external IP ---"
curl -s https://api.ipify.org || echo "Could not get IP"

rm -f /tmp/debug-query.duckdb /tmp/icfs-noauth-headers.txt /tmp/icfs-response.txt
echo "--- Done ---"
