#!/usr/bin/bash
set -xo pipefail

echo "=== Block devices ==="
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT

echo "=== Root filesystem ==="
df -h /

echo "=== /data filesystem ==="
df -h /data

echo "=== ZFS status ==="
sudo zpool status 2>&1 || echo "No ZFS pool"

echo "=== Config table ==="
sudo systemctl stop daily-orbit
duckdb /data/daily-orbit.duckdb "SELECT key, encrypted, length(value) as val_len FROM config ORDER BY key"
sudo systemctl start daily-orbit

echo "=== Boot log key events ==="
sudo grep -v 'Completed.*remaining\|download: s3://\|Reading \|Building \|Fetched \|Get:\|Selecting \|Preparing \|Unpacking \|Setting up \|Processing \|Created symlink\|Need to get\|upgraded,\|Reading database' /var/log/user-data.log
