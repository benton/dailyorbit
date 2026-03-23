#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

exec > >(tee /var/log/user-data.log) 2>&1
echo "=== user-data start: $(date -u) ==="

# ── Bootstrap: install AWS CLI ────────────────────────────────────────────────
apt-get update -qq
apt-get install -y unzip curl
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip
unzip -qo /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

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

# ── ZFS Pool Setup (NVMe instances only) ──────────────────────────────────────
# Find unformatted NVMe devices (ephemeral instance storage has no filesystem)
EPHEMERALS=""
for dev in /dev/nvme*n1; do
  [ -b "$dev" ] || continue
  blkid "$dev" >/dev/null 2>&1 && continue  # has a filesystem → EBS, skip
  EPHEMERALS="$EPHEMERALS $dev"
done
EPHEMERALS=$(echo "$EPHEMERALS" | xargs)  # trim

if [ -n "$EPHEMERALS" ]; then
  echo "NVMe ephemeral devices found: $EPHEMERALS"
  apt-get install -y zfsutils-linux
  modprobe zfs

  zpool create -f datapool $EPHEMERALS
  zfs set compression=lz4 datapool
  zfs set atime=off datapool
  mkdir -p /data
  zfs set mountpoint=/data datapool
  echo "ZFS pool created on NVMe storage"
else
  echo "No NVMe ephemeral devices — using EBS /data"
  mkdir -p /data
fi

# ── Data Restore from S3 ─────────────────────────────────────────────────────
aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/{{DB_SNAPSHOT_KEY}}" /data/daily-orbit.duckdb \
  || echo "No DB snapshot found — container will initialize fresh"

aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
  || echo "No encryption key found"

mkdir -p /data/attachments
aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
  || echo "No attachments found in S3"

# ── Install Docker, DuckDB CLI, and Launch Container ─────────────────────────
apt-get install -y docker.io cron
curl -fsSL "https://github.com/duckdb/duckdb/releases/download/v1.2.2/duckdb_cli-linux-aarch64.zip" \
  -o /tmp/duckdb.zip
unzip -qo /tmp/duckdb.zip -d /usr/local/bin
rm /tmp/duckdb.zip
chmod +x /usr/local/bin/duckdb
systemctl enable docker
systemctl start docker
systemctl enable cron
systemctl start cron

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
            "file_path": "/var/lib/docker/containers/*/*.log",
            "log_group_name": "/daily-orbit/app",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%dT%H:%M:%S"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/daily-orbit/user-data",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%d %H:%M:%S"
          },
          {
            "file_path": "/var/log/db-snapshot.log",
            "log_group_name": "/daily-orbit/db-snapshot",
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

# ── Data Snapshot Cron ────────────────────────────────────────────────────────
cat > /usr/local/bin/db-snapshot.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail

# Checkpoint DuckDB to fold WAL into main file
docker exec daily-orbit ./daily-orbit db checkpoint || true

# Copy DB to temp location, then push to S3
cp /data/daily-orbit.duckdb /data/daily-orbit-snap.duckdb
aws s3 cp /data/daily-orbit-snap.duckdb "s3://{{DB_SNAPSHOT_BUCKET}}/{{DB_SNAPSHOT_KEY}}"
aws s3 cp /data/daily-orbit-snap.duckdb "s3://{{DB_SNAPSHOT_BUCKET}}/db/$(date +%Y%m%d-%H%M).duckdb"
rm /data/daily-orbit-snap.duckdb

# Also push the encryption key
aws s3 cp /data/daily-orbit.key "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" || true

# Sync attachments (only uploads new/changed files)
aws s3 sync /data/attachments/ "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" --size-only
SCRIPT
chmod +x /usr/local/bin/db-snapshot.sh

echo "*/{{SNAPSHOT_INTERVAL}} * * * * root /usr/local/bin/db-snapshot.sh >> /var/log/db-snapshot.log 2>&1" \
  > /etc/cron.d/db-snapshot

# ── Spot Interruption / Shutdown Hook ─────────────────────────────────────────
cat > /etc/systemd/system/db-snapshot-on-shutdown.service << 'EOF'
[Unit]
Description=Snapshot DuckDB to S3 on shutdown
DefaultDependencies=no
Before=shutdown.target reboot.target halt.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/db-snapshot.sh
TimeoutStartSec=90

[Install]
WantedBy=halt.target reboot.target shutdown.target
EOF
systemctl enable db-snapshot-on-shutdown

echo "=== user-data complete: $(date -u) ==="
