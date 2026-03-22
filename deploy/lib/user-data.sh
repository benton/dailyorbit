#!/bin/bash
set -euo pipefail

# ── ZFS Pool Setup ────────────────────────────────────────────────────────────
yum install -y zfs-utils
modprobe zfs

# Discover NVMe ephemeral devices (exclude root EBS)
EPHEMERALS=$(nvme list | grep "Instance Storage" | awk '{print $1}')

# Create a striped zpool across all ephemeral drives
zpool create -f datapool $EPHEMERALS
zfs set compression=lz4 datapool
zfs set atime=off datapool
mkdir -p /data
zfs set mountpoint=/data datapool

# ── Elastic IP Association ────────────────────────────────────────────────────
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id)

aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "{{EIP_ALLOCATION_ID}}"

# ── TLS Certificate Fetch ────────────────────────────────────────────────────
mkdir -p /tmp/tls
mount -t tmpfs -o size=1m,mode=700 tmpfs /tmp/tls

aws secretsmanager get-secret-value \
  --secret-id "daily-orbit/tls-cert" \
  --query SecretString --output text > /tmp/tls/cert.pem

aws secretsmanager get-secret-value \
  --secret-id "daily-orbit/tls-key" \
  --query SecretString --output text > /tmp/tls/key.pem

chmod 600 /tmp/tls/key.pem

# ── Data Restore from S3 ─────────────────────────────────────────────────────
aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/{{DB_SNAPSHOT_KEY}}" /data/daily-orbit.duckdb \
  || echo "No DB snapshot found — container will initialize fresh"

aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
  || true

mkdir -p /data/attachments
aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
  || echo "No attachments found in S3"

# ── Install Docker and Launch Container ───────────────────────────────────────
yum install -y docker
systemctl enable docker
systemctl start docker

aws ecr get-login-password --region {{REGION}} | \
  docker login --username AWS --password-stdin {{ECR_URI}}

docker pull {{ECR_URI}}:{{CONTAINER_TAG}}
docker run -d \
  --name daily-orbit \
  --restart unless-stopped \
  --network host \
  -v /data:/app/data \
  -v /tmp/tls:/app/tls:ro \
  -e SERVE_STATIC=true \
  -e NODE_ENV=production \
  -e TLS_CERT_PATH=/app/tls/cert.pem \
  -e TLS_KEY_PATH=/app/tls/key.pem \
  {{ECR_URI}}:{{CONTAINER_TAG}}

# ── Data Snapshot Cron ────────────────────────────────────────────────────────
cat > /usr/local/bin/db-snapshot.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail

# Checkpoint DuckDB to fold WAL into main file
docker exec daily-orbit ./daily-orbit db checkpoint || true

# Copy DB to temp location, then push to S3
cp /data/daily-orbit.duckdb /tmp/daily-orbit-snap.duckdb
aws s3 cp /tmp/daily-orbit-snap.duckdb "s3://{{DB_SNAPSHOT_BUCKET}}/{{DB_SNAPSHOT_KEY}}"
aws s3 cp /tmp/daily-orbit-snap.duckdb "s3://{{DB_SNAPSHOT_BUCKET}}/db/$(date +%Y%m%d-%H%M).duckdb"
rm /tmp/daily-orbit-snap.duckdb

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
