#!/usr/bin/bash
# Generic production-side debugging script — edit the commands below as needed.
# Upload and run via: ./run_in_prod.sh debug_ec2_instance.sh
set -eox pipefail

echo "=== Debug snapshot: $(date -u) ==="

# ── System ──────────────────────────────────────────────────────────────────
echo "--- Disk usage ---"
df -h /data

echo "--- Memory ---"
free -h

echo "--- Uptime ---"
uptime

# ── Application ─────────────────────────────────────────────────────────────
echo "--- Service status ---"
systemctl is-active daily-orbit.service && echo "running" || echo "NOT running"

echo "--- Container ---"
sudo docker ps --filter name=daily-orbit --format '{{.Status}}'

echo "--- Recent logs (last 30 lines) ---"
sudo journalctl -u daily-orbit --no-pager -n 30

# ── Database ────────────────────────────────────────────────────────────────
echo "--- DuckDB file ---"
ls -lh /data/daily-orbit.duckdb

# ── Add your debug commands below this line ─────────────────────────────────
# copy production DB to a second file for querying
# run a query
