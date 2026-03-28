#!/usr/bin/bash
# Generic production-side debugging script — edit the commands below as needed.
# Upload and run via: ./run_in_prod.sh debug_ec2_instance.sh
set -eox pipefail

echo "=== Debug snapshot: $(date -u) ==="

IMAGE=$(sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep daily-orbit | head -1)
echo "Using image: $IMAGE"

# Kill any stale containers and ensure service is stopped
sudo docker kill $(sudo docker ps -q) 2>/dev/null || true
sudo systemctl stop daily-orbit 2>/dev/null || true

# Remove stale DuckDB lock files
rm -f /data/daily-orbit.duckdb.wal /data/daily-orbit.duckdb.tmp 2>/dev/null || true

echo "--- Waiting 2s for lock release ---"
sleep 2

# Run attachment download pipeline with canary download
echo "=== Running pipeline with canary download ==="
sudo docker run --rm --network host -v /data:/app/data \
  -e NODE_ENV=production \
  "$IMAGE" attachments download --concurrency 1 --verbose \
  --auth-cookies data/icfs-cookies.json 2>&1

echo "=== DONE ==="
