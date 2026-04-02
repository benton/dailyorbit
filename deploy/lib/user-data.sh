#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

exec > >(tee /var/log/user-data.log) 2>&1
echo "=== user-data start: $(date -u) ==="

# ── Bootstrap: install AWS CLI ────────────────────────────────────────────────
apt-get update -qq
apt-get install -y unzip curl nvme-cli bpytop
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip
unzip -qo /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

# ── Grow root filesystem to fill EBS volume ─────────────────────────────────
ROOT_DEV=$(findmnt -n -o SOURCE /)
ROOT_DISK=$(lsblk -npo PKNAME "$ROOT_DEV")
ROOT_PARTNUM=$(cat /sys/class/block/$(basename "$ROOT_DEV")/partition)
growpart "$ROOT_DISK" "$ROOT_PARTNUM" || true
resize2fs "$ROOT_DEV" || true
echo "Root filesystem: $(df -h / | tail -1)"

# ── Elastic IP Association ────────────────────────────────────────────────────
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id)

aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "{{EIP_ALLOCATION_ID}}" \
  --region "{{REGION}}"

echo "EIP associated to $INSTANCE_ID"

# ── Data Volume Setup ─────────────────────────────────────────────────────────
DATA_VOLUME_ID="{{DATA_VOLUME_ID}}"
DEVICE_PATH="/dev/xvdf"

# Attach the persistent EBS volume
echo "Attaching EBS volume $DATA_VOLUME_ID..."
aws ec2 attach-volume \
  --volume-id "$DATA_VOLUME_ID" \
  --instance-id "$INSTANCE_ID" \
  --device "$DEVICE_PATH" \
  --region "{{REGION}}"

# Wait for attachment (up to 60 seconds)
for i in $(seq 1 30); do
  if [ -b "$DEVICE_PATH" ] || [ -b "/dev/nvme1n1" ]; then
    echo "Volume attached"
    break
  fi
  sleep 2
done

# On Nitro instances, /dev/xvdf maps to an NVMe device.
# Identify it by matching the volume ID in the NVMe controller serial number.
ACTUAL_DEVICE="$DEVICE_PATH"
VOL_SHORT="${DATA_VOLUME_ID#vol-}"
for nvme_dev in /dev/nvme*n1; do
  [ -b "$nvme_dev" ] || continue
  serial=$(nvme id-ctrl "$nvme_dev" -o json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('sn','').strip())" 2>/dev/null || true)
  if echo "$serial" | grep -qi "$VOL_SHORT"; then
    ACTUAL_DEVICE="$nvme_dev"
    echo "Resolved $DATA_VOLUME_ID → $ACTUAL_DEVICE (serial: $serial)"
    break
  fi
done

# Format if new (no filesystem), otherwise mount existing
if ! blkid "$ACTUAL_DEVICE" >/dev/null 2>&1; then
  echo "New volume detected — formatting as ext4"
  mkfs.ext4 -L daily-orbit-data "$ACTUAL_DEVICE"
  NEEDS_RESTORE=true
else
  echo "Existing filesystem found"
  NEEDS_RESTORE=false
fi

mkdir -p /data
mount "$ACTUAL_DEVICE" /data

# If the volume is empty (first boot or disaster), restore from S3
if [ "$NEEDS_RESTORE" = true ] || [ ! -f /data/daily-orbit.duckdb ]; then
  echo "No database found on volume — restoring from S3..."

  # Try Parquet fast-restore first (Phase 2), fall back to full snapshot
  if [ -f /data/parquet-restore.sh ]; then
    bash /data/parquet-restore.sh
  else
    DB_SNAPSHOT=$(aws s3 ls "s3://{{DB_SNAPSHOT_BUCKET}}/db/" --recursive \
      | grep -oE 'db/[0-9]{8}-[0-9]{4}\.duckdb$' \
      | sort | tail -1)

    if [ -n "$DB_SNAPSHOT" ]; then
      echo "Restoring snapshot: $DB_SNAPSHOT"
      aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/${DB_SNAPSHOT}" /data/daily-orbit.duckdb
    else
      echo "WARNING: No snapshot found — container will initialize fresh database"
    fi
  fi

  aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
    || echo "No encryption key found"
  mkdir -p /data/attachments
  aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
    || echo "No attachments found in S3"
fi

chown -R ubuntu:ubuntu /data

# ── Install Docker, DuckDB CLI, Python/uv, and Launch Container ──────────────
apt-get install -y docker.io python3
curl -fsSL https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh
curl -fsSL "https://github.com/duckdb/duckdb/releases/download/v1.5.1/duckdb_cli-linux-arm64.zip" \
  -o /tmp/duckdb.zip
unzip -qo /tmp/duckdb.zip -d /usr/local/bin
rm /tmp/duckdb.zip
chmod +x /usr/local/bin/duckdb

# Store Docker images on the persistent data volume (root EBS is too small for Chromium)
mkdir -p /data/docker /etc/docker
cat > /etc/docker/daemon.json << 'DOCKERCFG'
{
  "data-root": "/data/docker"
}
DOCKERCFG

systemctl enable docker
systemctl start docker

aws ecr get-login-password --region {{REGION}} | \
  docker login --username AWS --password-stdin {{ECR_URI}}

docker pull {{ECR_URI}}:{{CONTAINER_TAG}}

# Create systemd unit for the application container
cat > /etc/systemd/system/daily-orbit.service << 'SVCEOF'
[Unit]
Description=Daily Orbit API Server
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=on-failure
RestartSec=10
TimeoutStartSec=120

ExecStartPre=-/usr/bin/docker rm -f daily-orbit
ExecStart=/usr/bin/docker run \
  --name daily-orbit \
  --network host \
  --log-opt max-size=100m \
  --log-opt max-file=3 \
  -v /data:/app/data \
  -e NODE_ENV=production \
  {{ECR_URI}}:{{CONTAINER_TAG}}

ExecStop=/usr/bin/docker stop daily-orbit
ExecStopPost=-/usr/bin/docker rm -f daily-orbit

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable daily-orbit
systemctl start daily-orbit

# ── CloudWatch Agent ───────────────────────────────────────────────────────
# Install the unified CloudWatch agent for ARM64
curl -fsSL "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb" \
  -o /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb
rm /tmp/amazon-cloudwatch-agent.deb

# Write agent config — ship container logs, user-data log, and snapshot log
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << CWCONFIG
{
  "agent": {
    "region": "{{REGION}}"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/data/docker/containers/*/*.log",
            "log_group_name": "/daily-orbit/app",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%dT%H:%M:%S"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/daily-orbit/user-data",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%d %H:%M:%S"
          }
        ]
      }
    }
  }
}
CWCONFIG

# Start the agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# ── Spot Interruption / Shutdown Hook ─────────────────────────────────────────
# Trigger an in-process backup via the CLI before the container stops.
cat > /etc/systemd/system/db-snapshot-on-shutdown.service << 'EOF'
[Unit]
Description=Snapshot DuckDB to S3 on shutdown
DefaultDependencies=no
Before=shutdown.target reboot.target halt.target
After=daily-orbit.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec daily-orbit ./daily-orbit db snapshot
TimeoutStartSec=90

[Install]
WantedBy=halt.target reboot.target shutdown.target
EOF
systemctl enable db-snapshot-on-shutdown

echo "=== user-data complete: $(date -u) ==="
