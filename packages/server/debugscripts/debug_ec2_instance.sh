#!/usr/bin/bash
# Recovery: kill the stuck user-data attach loop and run the rest of the bootstrap manually.
set -x

DATA_VOLUME_ID="vol-0283624e12ef2be3a"

echo "=== killing stuck attach-volume loop in user-data ==="
# Find the bash running cloud-init user-data and kill it
sudo pkill -9 -f "user-data\.sh" || true
sudo pkill -9 -f "aws ec2 attach-volume" || true
# cloud-init runs scripts via runcmd -> script file, kill any cloud-init child still running
ps -ef | grep -E "cloud-init|user-data|attach-volume" | grep -v grep || true

echo "=== verify volume attached ==="
ls -la /dev/disk/by-id/ | grep -i "Amazon_Elastic" || echo "no by-id symlink"
lsblk

echo "=== mount the volume ==="
VOLUME_SERIAL="${DATA_VOLUME_ID//-/}"
BY_ID_PATH="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${VOLUME_SERIAL}"
if [ -e "$BY_ID_PATH" ]; then
  FS_DEV=$(readlink -f "$BY_ID_PATH")
  echo "Resolved $BY_ID_PATH → $FS_DEV"
  sudo mkdir -p /data
  sudo mount "$FS_DEV" /data && echo "mounted" || echo "mount FAILED"
  df -h /data
  ls -la /data | head -5
else
  echo "WARN: by-id symlink missing. Trying nvme1n1/nvme2n1 fallback"
  for dev in /dev/nvme1n1 /dev/nvme2n1 /dev/nvme0n1; do
    if [ -b "$dev" ]; then
      sudo blkid "$dev" || true
    fi
  done
fi
