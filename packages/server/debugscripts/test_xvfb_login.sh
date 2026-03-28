#!/usr/bin/env bash
# Write decrypted password to /tmp/pwd.txt, then test login with screenshot
set -euo pipefail

CONTAINER="daily-orbit"

echo "==> Dumping decrypted password..."
sudo docker exec "$CONTAINER" xvfb-run --auto-servernum ./daily-orbit config get icfsPassword 2>&1 | tee /tmp/pwd.txt

echo ""
echo "==> Running headed login with screenshot capture..."
sudo docker exec "$CONTAINER" xvfb-run --auto-servernum ./daily-orbit attachments login --headed 2>&1 || true

echo ""
echo "==> Copying screenshot from container to host /tmp/..."
sudo docker cp "$CONTAINER:/tmp/icfs-login-failure.png" /tmp/icfs-login-failure.png 2>/dev/null && echo "Screenshot saved to /tmp/icfs-login-failure.png on host" || echo "No screenshot captured"

echo "==> Done"
