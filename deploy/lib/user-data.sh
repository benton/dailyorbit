#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export DATA_VOLUME_ID="{{DATA_VOLUME_ID}}"
export REGION="{{REGION}}"
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"

exec > >(tee /var/log/user-data.log) 2>&1
echo "=== user-data start: $(date -u) ==="

# ── Bootstrap: install AWS CLI ────────────────────────────────────────────────
apt-get update -qq
apt-get install -y unzip curl nvme-cli bpytop docker.io python3
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
  --region "$REGION"

echo "EIP associated to $INSTANCE_ID"

# ── Data Volume Setup ─────────────────────────────────────────────────────────
EBS_DEVICE="/dev/sdf"

mkdir -pv /data

# Attach the persistent EBS volume.
#
# During a rolling instance refresh the new box can boot before the old one
# has fully released the volume — `attach-volume` then fails with VolumeInUse.
# A graceful shutdown usually releases the volume in seconds, but a stuck or
# unresponsive prior instance can hold it until EC2 force-detaches, which can
# take much longer. Retry for up to an hour so a slow release never strands
# the new instance.
echo "Attaching EBS volume $DATA_VOLUME_ID..."
attached=false
MAX_ATTACH_ATTEMPTS=360  # 360 × 10s = ~1 hour
for attempt in $(seq 1 $MAX_ATTACH_ATTEMPTS); do
  if aws ec2 attach-volume \
      --volume-id "$DATA_VOLUME_ID" \
      --instance-id "$INSTANCE_ID" \
      --device "$EBS_DEVICE" \
      --region "$REGION"; then
    echo "attach-volume succeeded on attempt $attempt"
    attached=true
    break
  fi
  echo "attach-volume failed on attempt $attempt/$MAX_ATTACH_ATTEMPTS — likely still attached to terminating instance, sleeping 10s..."
  sleep 10
done
if [ "$attached" != "true" ]; then
  echo "ERROR: attach-volume never succeeded after $MAX_ATTACH_ATTEMPTS attempts (~1 hour). Aborting."
  exit 1
fi

# Wait for EBS volume attachment via AWS API (up to 10 minutes).
# Normally this flips to `attached` within seconds of a successful attach-volume
# call, but keep a generous ceiling in case the control plane is slow.
for i in $(seq 1 300); do
  state=$(aws ec2 describe-volumes \
    --volume-ids "$DATA_VOLUME_ID" \
    --region "$REGION" \
    --query "Volumes[0].Attachments[0].State" \
    --output text 2>/dev/null || echo "unknown")
  if [ "$state" = "attached" ]; then
    echo "Volume $DATA_VOLUME_ID attached"
    break
  fi
  echo "Waiting for attachment (state: $state)..."
  sleep 2
done

# Resolve the EBS volume's NVMe device node via its volume ID.
# On Nitro instances, udev creates a stable symlink per EBS volume at
# /dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol<id-no-dash>,
# which points to the kernel-assigned /dev/nvmeXnY. This works on any
# instance type — with or without a local instance-store drive — so we
# can freely diversify the ASG's spot instance pool across families.
VOLUME_SERIAL="${DATA_VOLUME_ID//-/}"
BY_ID_PATH="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${VOLUME_SERIAL}"
# Wait up to 5 minutes for udev to create the symlink after attach.
for i in $(seq 1 150); do
  if [ -e "$BY_ID_PATH" ]; then
    break
  fi
  echo "Waiting for udev symlink $BY_ID_PATH..."
  sleep 2
done
if [ ! -e "$BY_ID_PATH" ]; then
  echo "ERROR: udev never created $BY_ID_PATH for $DATA_VOLUME_ID"
  exit 1
fi
FILESYSTEM_DEV=$(readlink -f "$BY_ID_PATH")
if [ ! -b "$FILESYSTEM_DEV" ]; then
  echo "ERROR: $BY_ID_PATH resolved to $FILESYSTEM_DEV which is not a block device"
  exit 1
fi
echo "Resolved $DATA_VOLUME_ID → $FILESYSTEM_DEV"

mount "$FILESYSTEM_DEV" /data
echo "Mounted $FILESYSTEM_DEV → /data: $(df -h /data | tail -1)"


# If the database is missing (disaster recovery), restore from S3
if [ ! -f /data/daily-orbit.duckdb ]; then
  echo "No database found on volume — restoring from S3..."

  DB_SNAPSHOT=$(aws s3 ls "s3://{{DB_SNAPSHOT_BUCKET}}/db/" --recursive \
    | grep -oE 'db/[0-9]{8}-[0-9]{4}\.duckdb$' \
    | sort | tail -1)

  if [ -n "$DB_SNAPSHOT" ]; then
    echo "Restoring snapshot: $DB_SNAPSHOT"
    aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/${DB_SNAPSHOT}" /data/daily-orbit.duckdb
  else
    echo "WARNING: No snapshot found — container will initialize fresh database"
  fi

  aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
    || echo "No encryption key found"
  mkdir -p /data/attachments
  aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
    || echo "No attachments found in S3"
fi

chown -R ubuntu:ubuntu /data

# ── Install DuckDB CLI, Python/uv, and Launch Container ──────────────
# apt-get install -y docker.io python3 ^^ moved to top
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

aws ecr get-login-password --region $REGION | \
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
