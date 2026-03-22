# Plan: CDK Deployment Skeleton

## Context

Daily Orbit is a single-process Node 23 app with a DuckDB database (~27 GB), served as a Docker container (port 9000, `SERVE_STATIC=true`). The existing Dockerfile produces a production image. We need a CDK-based deployment that gets the UI up and responsive so the admin can configure everything else through the app.

This plan covers the skeleton: project scaffolding, a single-instance EC2 Spot stack with fast local storage, direct HTTPS termination, and the Make/config plumbing. It intentionally omits CI/CD pipelines and advanced monitoring — those can be layered on later.

### Assumptions

- A production container image is already in ECR (or is built and pushed by CDK)
- `dailyorbit.org` is registered and hosted in Route 53
- An ACM certificate has been manually allocated; its ARN is in the seed config
- The certificate material is exported and stored in Secrets Manager for in-process TLS termination (no ALB)

---

## Architecture Decisions

**Why EC2 Spot over Fargate + ALB + EFS:**

| Axis | Fargate + ALB + EFS | EC2 Spot + EIP |
|------|---:|---:|
| **Cost** | ~$80–120+/mo (EFS IO charges dominate) | ~$37/mo |
| **DB IO latency** | 1–5 ms (network FS) | <100 μs (local NVMe) |
| **Vertical headroom** | 4 vCPU / 30 GB max | 96 vCPU / 768 GB (r6id.24xlarge) |

DuckDB does heavy random reads across a large columnar file. Network filesystem latency taxes every page fault. Local NVMe with ZFS striping eliminates this entirely.

**Compute:** Single-instance ASG (min=1, max=1) with Spot capacity. The ASG provides self-healing: if the instance is reclaimed or fails a health check, a replacement launches automatically.

**Storage:** ZFS pool striped across the instance's ephemeral NVMe drives. DuckDB database is pulled from S3 on boot and snapshotted back to S3 on a cron schedule. Attachments are synced to/from S3 alongside the DB (the `data/attachments/` tree maps cleanly to S3 key prefixes by subsystem/filing).

**Networking:** Elastic IP re-associated on instance launch (via user data script). Route 53 A record points `dailyorbit.org` → EIP. No ALB — the app terminates HTTPS directly.

**TLS:** Certificate private key and chain stored in AWS Secrets Manager. The user data script fetches them on boot and writes to a tmpfs. `@hono/node-server` `serve()` already accepts a `createServer` option typed for `node:https` — we pass `https.createServer` with the cert/key to bind port 443 directly. A second listener on port 80 issues 301 redirects.

**Container Registry:** ECR repository in the same account/region.

**Config Model:** One seed JSON file per account/region combination, stored at `deploy/config/aws-{account}-{region}-seed.json`. Contains only bootstrap values needed to get the instance running. All application config is managed through the admin UI after first deploy.

---

## Resolved Questions

1. **Health check endpoint** — Already exists at `packages/server/src/app.ts:47`. No work needed.

2. **Database seeding on first deploy** — Fully handled. `packages/server/src/cli/serve/api.ts:126-147` detects when neither DB nor key file exists, generates a fresh encryption key, initializes the schema via `initializeDatabase()`, and seeds default config. The S3 restore step in user data gracefully falls through (`|| true`), and the container starts clean.

3. **ARM64 Docker build** — Use `docker buildx build --platform linux/arm64` when building on x86. Document in the Makefile target. Graviton instances (ARM64) are ~20% cheaper on Spot.

4. **Attachment storage** — Attachments live at `data/attachments/{subsystem}/{fileNumber}/{key}.{ext}` on local disk. The snapshot cron syncs the entire `data/attachments/` tree to S3 alongside the DB file using `aws s3 sync`. On boot, the restore step pulls both the DB and the attachment tree back down. This keeps attachments durable without migrating to S3-native serving (which is a separate, larger change).

5. **WAL consistency during snapshot** — The cron script issues `./daily-orbit db checkpoint` (a CLI command we'll add — it runs `CHECKPOINT` on the open database) before copying the `.duckdb` file. After checkpoint, the WAL is folded into the main file and the copy is guaranteed consistent. The shutdown hook does the same before the final S3 push.

---

## Seed Config Schema

```jsonc
// deploy/config/aws-123456789012-us-east-1-seed.json
{
  "stackName": "daily-orbit-prod",          // CloudFormation stack name
  "domainName": "dailyorbit.org",           // Route 53 hosted zone + app domain
  "certificateArn": "arn:aws:acm:...",      // Pre-allocated ACM certificate ARN
  "vpcId": null,                            // null = create new VPC; string = import existing
  "instanceType": "r6id.xlarge",            // Instance type (must have NVMe ephemeral)
  "dbSnapshotBucket": "daily-orbit-backups",// S3 bucket for DuckDB snapshots + attachments
  "dbSnapshotKey": "db/latest.duckdb",      // S3 object key for the DB file
  "ecrRepositoryName": "daily-orbit",       // ECR repo name
  "containerTag": "latest",                 // Image tag to pull
  "snapshotIntervalMinutes": 60,            // How often to push DB + attachments to S3
  "healthCheckPath": "/api/health",         // ASG health check endpoint
  "tags": {
    "Project": "daily-orbit",
    "Environment": "prod"
  }
}
```

---

## Task 1: Add `deploy/` Workspace Package

Create `deploy/` as a new pnpm workspace package containing the CDK app.

### 1a. Update `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "deploy"
```

### 1b. Create `deploy/package.json`

```jsonc
{
  "name": "@daily-orbit/deploy",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "cdk": "cdk",
    "synth": "cdk synth",
    "diff": "cdk diff",
    "deploy": "cdk deploy",
    "destroy": "cdk destroy"
  },
  "devDependencies": {
    "aws-cdk": "^2",
    "aws-cdk-lib": "^2",
    "constructs": "^10",
    "typescript": "^5"
  }
}
```

### 1c. Create `deploy/tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2022"],
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "noEmit": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 1d. Create `deploy/cdk.json`

```jsonc
{
  "app": "npx ts-node --esm bin/app.ts",
  "context": {
    "@aws-cdk/core:bootstrapQualifier": "daily-orbit"
  }
}
```

---

## Task 2: CDK App Entry Point

**File:** `deploy/bin/app.ts`

- Read `DEPLOY_CONFIG` env var (path to a seed JSON file), defaulting to autodetection from the current AWS account/region
- Parse and validate the seed config
- Instantiate the stack with the seed values

```ts
import { App } from 'aws-cdk-lib';
import { DailyOrbitStack } from '../lib/stack.js';
import { loadSeedConfig } from '../lib/config.js';

const app = new App();
const config = loadSeedConfig();

new DailyOrbitStack(app, config.stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  config,
});
```

---

## Task 3: Config Loader

**File:** `deploy/lib/config.ts`

- Define a `SeedConfig` TypeScript interface matching the schema above
- `loadSeedConfig()`: reads from `DEPLOY_CONFIG` env var, or auto-resolves to `deploy/config/aws-{account}-{region}-seed.json` using `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`
- Validate required fields (`stackName`, `domainName`, `certificateArn`, `dbSnapshotBucket`)
- Apply defaults for optional fields (`instanceType` → `r6id.xlarge`, `containerTag` → `latest`, etc.)
- Export the typed config

---

## Task 4: User Data Script

**File:** `deploy/lib/user-data.sh` (templated by CDK with `UserData.custom()`)

The user data script runs on every instance launch. It must be idempotent.

### 4a. ZFS Pool Setup

```bash
#!/bin/bash
set -euo pipefail

# Install ZFS (Amazon Linux 2023)
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
```

### 4b. Elastic IP Association

```bash
# Fetch instance metadata (IMDSv2)
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id)

# Associate the Elastic IP (allocation ID injected by CDK template)
aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "{{EIP_ALLOCATION_ID}}"
```

### 4c. TLS Certificate Fetch

```bash
mkdir -p /tmp/tls
mount -t tmpfs -o size=1m,mode=700 tmpfs /tmp/tls

# Fetch cert chain and private key from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id "daily-orbit/tls-cert" \
  --query SecretString --output text > /tmp/tls/cert.pem

aws secretsmanager get-secret-value \
  --secret-id "daily-orbit/tls-key" \
  --query SecretString --output text > /tmp/tls/key.pem

chmod 600 /tmp/tls/key.pem
```

### 4d. Data Restore from S3

```bash
# Pull latest DuckDB snapshot (falls through cleanly on first deploy)
aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/{{DB_SNAPSHOT_KEY}}" /data/daily-orbit.duckdb \
  || echo "No DB snapshot found — container will initialize fresh"

# Pull encryption key if it exists
aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
  || true

# Sync attachments tree
mkdir -p /data/attachments
aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
  || echo "No attachments found in S3"
```

### 4e. Install Docker and Container Launch

```bash
# Install Docker (Amazon Linux 2023)
yum install -y docker
systemctl enable docker
systemctl start docker

# ECR login
aws ecr get-login-password --region {{REGION}} | \
  docker login --username AWS --password-stdin {{ECR_URI}}

# Pull and run
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
```

### 4f. Data Snapshot Cron

```bash
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

# Schedule via cron
echo "*/{{SNAPSHOT_INTERVAL}} * * * * root /usr/local/bin/db-snapshot.sh >> /var/log/db-snapshot.log 2>&1" \
  > /etc/cron.d/db-snapshot
```

---

## Task 5: Main Stack

**File:** `deploy/lib/stack.ts`

The stack creates these resources in order:

### 5a. Networking
- **VPC**: Create new (2 AZ, 1 NAT gateway) or import existing based on `vpcId`
- **Security Group**: Ingress on 443 (HTTPS) and 80 (HTTP → 301 redirect) from `0.0.0.0/0`; egress all
- **Elastic IP**: Allocated by the stack; allocation ID passed into user data template

### 5b. DNS
- **Route 53 A Record**: `dailyorbit.org` → Elastic IP
- **Route 53 A Record**: `www.dailyorbit.org` → same Elastic IP
- Hosted zone looked up by `domainName` from seed config

### 5c. Secrets
- **Secrets Manager Secret**: `daily-orbit/tls-cert` — the certificate chain (PEM)
- **Secrets Manager Secret**: `daily-orbit/tls-key` — the private key (PEM)
- These are created as empty placeholders by the stack; the operator populates them via `make deploy-seed-secrets` before first deploy

### 5d. Storage
- **S3 Bucket**: `dbSnapshotBucket` from seed config — versioning enabled, lifecycle rule to expire non-current versions after 30 days
- Bucket policy allows the instance role to `GetObject`, `PutObject`, `ListBucket`

### 5e. Container Registry
- **ECR Repository**: `daily-orbit`, image tag mutability enabled, lifecycle rule to expire untagged images after 7 days

### 5f. IAM
- **Instance Role** with policies for:
  - `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` (pull images)
  - `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the snapshot bucket
  - `secretsmanager:GetSecretValue` on the TLS secrets
  - `ec2:AssociateAddress` on the Elastic IP
  - `bedrock:InvokeModel` (for AI features)
  - `ses:SendEmail`, `ses:SendRawEmail` (for alerts)
- **Instance Profile** wrapping the role

### 5g. Compute
- **Launch Template**:
  - AMI: Amazon Linux 2023 (ARM64 for Graviton)
  - Instance type from seed config (default `r6id.xlarge`: 4 vCPU, 32 GB, 1x237 GB NVMe)
  - Instance profile from 5f
  - User data script from Task 4 (templated with CDK values)
  - Security group from 5a
  - Metadata: IMDSv2 required
  - Block device: root volume only (ephemeral NVMe is auto-attached)
- **Auto Scaling Group**:
  - Min=1, Max=1, Desired=1
  - Mixed instances policy with Spot allocation (on-demand fallback)
  - Health check: EC2 status checks (ASG default)
  - Default instance warmup: 300 seconds (time for ZFS + S3 restore + container pull)

### 5h. Outputs
- Elastic IP address
- App URL (`https://dailyorbit.org`)
- ECR repository URI
- S3 snapshot bucket name

---

## Task 6: Seed Config Files

### 6a. Create `deploy/config/` directory

### 6b. Create example seed config

**File:** `deploy/config/aws-EXAMPLE-us-east-1-seed.json`

A copy of the schema from the Seed Config Schema section with placeholder values. Checked in as a template; real configs are gitignored.

### 6c. Update `.gitignore`

Add:
```
# CDK
deploy/dist/
deploy/cdk.out/
deploy/config/aws-[0-9]*-*-seed.json
!deploy/config/aws-EXAMPLE-*-seed.json
```

---

## Task 7: Makefile Targets

Add to the root `Makefile`:

```makefile
# ── Deployment ────────────────────────────────────────────────────
CDK_DIR := deploy

deploy-synth: ## Synthesize CloudFormation template
	cd $(CDK_DIR) && pnpm cdk synth

deploy-diff: ## Show pending infrastructure changes
	cd $(CDK_DIR) && pnpm cdk diff

deploy-up: ## Deploy the stack
	cd $(CDK_DIR) && pnpm cdk deploy

deploy-destroy: ## Tear down the stack
	cd $(CDK_DIR) && pnpm cdk destroy

deploy-seed-secrets: ## Upload TLS cert+key to Secrets Manager (CERT=... KEY=...)
	aws secretsmanager put-secret-value \
		--secret-id daily-orbit/tls-cert \
		--secret-string "$$(cat $(CERT))"
	aws secretsmanager put-secret-value \
		--secret-id daily-orbit/tls-key \
		--secret-string "$$(cat $(KEY))"
```

Update `.PHONY` to include the new targets.

---

## Task 8: TLS Termination in Hono

**File:** `packages/server/src/cli/serve/api.ts` (modify the existing `serve()` call at line 170-174)

`@hono/node-server`'s `serve()` accepts a `createServer` option typed as `typeof import('node:https').createServer` and `serverOptions` for the TLS config. When `TLS_CERT_PATH` and `TLS_KEY_PATH` env vars are set:

```ts
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';

const tlsCert = process.env.TLS_CERT_PATH;
const tlsKey = process.env.TLS_KEY_PATH;

if (tlsCert && tlsKey) {
  // HTTPS on port 443
  serve({
    fetch: app.fetch,
    port: 443,
    createServer: createHttpsServer,
    serverOptions: {
      cert: readFileSync(tlsCert),
      key: readFileSync(tlsKey),
    },
  }, () => {
    console.log('Server running at https://0.0.0.0:443');
  });

  // HTTP → HTTPS redirect on port 80
  const redirect = new Hono();
  redirect.all('*', (c) => {
    const url = new URL(c.req.url);
    url.protocol = 'https:';
    url.port = '';
    return c.redirect(url.toString(), 301);
  });
  serve({ fetch: redirect.fetch, port: 80 });
} else {
  // Dev mode: plain HTTP
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running at http://localhost:${String(port)}`);
  });
}
```

This requires no new dependencies — `node:https` is built in and `@hono/node-server` already imports it.

---

## Task 9: Add `db checkpoint` CLI Command

**File:** `packages/server/src/cli/db/index.ts` (add subcommand)

Add a `checkpoint` subcommand that opens the database and runs `CHECKPOINT`:

```ts
export const dbCheckpointCommand = defineCommand({
  meta: { name: 'checkpoint', description: 'Force a WAL checkpoint' },
  async run() {
    const db = await getDb();
    await db.run('CHECKPOINT');
    console.log('Checkpoint complete');
  },
});
```

This is called by the snapshot cron (Task 4f) before copying the DB file to ensure WAL is folded in.

---

## Spot Interruption Handling

When AWS reclaims a Spot instance, the instance gets a 2-minute warning. The user data script installs a shutdown hook:

```bash
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
```

This reuses the same `db-snapshot.sh` script from the cron job. The container is stopped first (by the script calling `docker exec ... db checkpoint`), then the DB and attachments are pushed to S3. Maximum data loss window: the time between the Spot interruption notice and the completion of the S3 upload (well within the 2-minute window for a ~27 GB file over instance-local networking to S3).

---

## File Summary

| Action | Path |
|--------|------|
| Create | `deploy/package.json` |
| Create | `deploy/tsconfig.json` |
| Create | `deploy/cdk.json` |
| Create | `deploy/bin/app.ts` |
| Create | `deploy/lib/config.ts` |
| Create | `deploy/lib/stack.ts` |
| Create | `deploy/lib/user-data.sh` |
| Create | `deploy/config/aws-EXAMPLE-us-east-1-seed.json` |
| Edit   | `pnpm-workspace.yaml` (add `deploy`) |
| Edit   | `Makefile` (add deploy targets) |
| Edit   | `.gitignore` (add CDK + config patterns) |
| Edit   | `packages/server/src/cli/serve/api.ts` (TLS termination) |
| Create | `packages/server/src/cli/db/checkpoint.ts` (or add to existing db index) |

---

## Deployment Sequence (Operator Checklist)

1. `pnpm install` (picks up new `deploy/` workspace)
2. Copy `deploy/config/aws-EXAMPLE-us-east-1-seed.json` → `deploy/config/aws-{account}-{region}-seed.json`, fill in real values
3. `make deploy-synth` — verify the CloudFormation template
4. `make deploy-up` — creates all infrastructure (instance won't serve yet — no secrets, no image)
5. `make deploy-seed-secrets CERT=path/to/cert.pem KEY=path/to/key.pem`
6. Build and push Docker image to ECR (via CI or manual `docker buildx build --platform linux/arm64`)
7. Terminate the running instance (ASG replaces it, new instance pulls secrets + image)
8. Verify `https://dailyorbit.org/api/health` returns `{"status":"ok"}`
