# AWS Deployment

## Architecture Overview

Daily Orbit runs on AWS with a split architecture:

- **API server** (`api.dailyorbit.org`) — Single EC2 Spot instance in an Auto Scaling Group (min=1, max=1), running the Docker container with `--network host`. TLS terminates in Node.js using certs stored in the DuckDB database.
- **Frontend** (`dailyorbit.org`) — Static Vite build served from S3 via CloudFront.
- **Data durability** — DuckDB database, encryption key, and attachments are snapshotted to S3 on a cron schedule and on instance shutdown. Restored automatically on instance launch.

```
                    ┌──────────────────┐
  dailyorbit.org ──>│   CloudFront     │──> S3 (frontend bucket)
                    └──────────────────┘

                    ┌──────────────────┐
api.dailyorbit.org─>│   Elastic IP     │──> EC2 Spot (Ubuntu 24.04 ARM64)
                    └──────────────────┘    ├── Docker: daily-orbit container
                                            ├── ZFS on NVMe ephemeral storage
                                            └── /data: DuckDB + attachments
```

---

## Prerequisites

- AWS CLI v2 configured with credentials for the target account
- CDK bootstrapped in the target region: `cd deploy && pnpm cdk bootstrap --qualifier dailyorbit`
- An S3 bucket for DB snapshots (created outside CDK)
- ACM certificates:
  - **API cert** (in the deployment region, e.g. us-east-2) — for `api.dailyorbit.org`, created with "export enabled" so the private key can be extracted and stored in DuckDB for Node.js TLS termination
  - **CloudFront cert** (must be in us-east-1) — for `dailyorbit.org`
- A Route53 hosted zone for the domain
- An EC2 key pair (optional, for SSH access)

---

## Seed Config

Each deployment is driven by a JSON seed config at `deploy/config/aws-{account}-{region}-seed.json`. The CDK app auto-resolves this from `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, or you can set `DEPLOY_CONFIG` explicitly.

See `deploy/config/aws-EXAMPLE-us-east-1-seed.json` for the full schema. Required fields:

| Field | Description |
|---|---|
| `stackName` | CloudFormation stack name |
| `domainName` | Apex domain (e.g. `dailyorbit.org`) |
| `certificateArn` | ACM cert ARN for the API domain |
| `dbSnapshotBucket` | S3 bucket for DB snapshots (must already exist) |

Optional fields with defaults:

| Field | Default | Description |
|---|---|---|
| `apiDomainName` | — | API subdomain (e.g. `api.dailyorbit.org`) |
| `apiCertificateArn` | — | ACM cert for API TLS (export-enabled) |
| `cloudfrontCertificateArn` | — | ACM cert in us-east-1 for CloudFront |
| `vpcId` | `null` (creates new) | Existing VPC to use |
| `instanceType` | `r6gd.xlarge` | EC2 instance type (ARM64 + NVMe recommended) |
| `keyPairName` | `null` | SSH key pair name |
| `dbSnapshotKey` | `db/latest.duckdb` | S3 key for the latest DB snapshot |
| `ecrRepositoryName` | `daily-orbit` | ECR repository name |
| `containerTag` | `latest` | Docker image tag to deploy |
| `snapshotIntervalMinutes` | `60` | Cron interval for DB snapshots |
| `healthCheckPath` | `/api/health` | Health check endpoint |
| `tags` | `{Project: "daily-orbit"}` | Tags applied to all resources |

---

## CDK Stack Resources

The stack (`deploy/lib/stack.ts`) provisions:

- **Networking**: Security group (ports 22, 80, 443, 9000), Elastic IP
- **DNS**: Route53 A records — `api.*` to EIP, apex and `www` to CloudFront
- **ECR**: Container registry with 7-day untagged image expiry
- **IAM**: Instance role with ECR pull, S3 read/write, EIP association, Bedrock invoke, SES send, CloudWatch Logs (create log groups/streams, put events)
- **Compute**: Launch template (Ubuntu 24.04 ARM64, 30GB gp3 EBS) in a single-instance Spot ASG
- **CloudFront**: Distribution with S3 origin (OAC), SPA error routing (403/404 to `index.html`)
- **S3**: Frontend bucket (block public access, auto-delete on destroy)

---

## Instance Boot Sequence

The user-data script (`deploy/lib/user-data.sh`) runs on every instance launch:

1. **Bootstrap** — Install AWS CLI v2 (not pre-installed on Ubuntu)
2. **EIP association** — Self-associate the Elastic IP via IMDSv2
3. **ZFS setup** — Detect unformatted NVMe devices via `blkid` (ephemeral storage has no filesystem, EBS does). If found, install `zfsutils-linux`, create a striped pool with lz4 compression at `/data`. Otherwise, use EBS `/data`.
4. **S3 restore** — Download `daily-orbit.duckdb`, `daily-orbit.key`, and `attachments/` from the snapshot bucket
5. **Docker** — Install `docker.io`, pull from ECR, run container with `--network host`, `/data` volume, and log rotation (`max-size=100m`, `max-file=3`)
6. **CloudWatch agent** — Install the unified CloudWatch agent, configure it to ship container logs (`/daily-orbit/app`), user-data logs (`/daily-orbit/user-data`), and snapshot logs (`/daily-orbit/db-snapshot`) to CloudWatch Logs
7. **Snapshot cron** — Install cron job that checkpoints DuckDB, copies to S3 (latest + timestamped), syncs attachments
8. **Shutdown hook** — Systemd oneshot service that runs the snapshot script before halt/reboot (catches Spot interruptions)

Template variables (`{{VAR}}`) are replaced by CDK at synth time.

---

## TLS Configuration

TLS is terminated in Node.js, not at a load balancer. The certificate and private key are stored as encrypted config fields in DuckDB:

```bash
# One-time setup (on the instance):
# 1. Stop the running container
docker stop daily-orbit

# 2. Load certs via a throwaway container
docker run --rm -v /data:/app/data \
  <ECR_URI>:latest config set tlsCert --from-file /path/to/cert.pem
docker run --rm -v /data:/app/data \
  <ECR_URI>:latest config set tlsKey --from-file /path/to/key.pem

# 3. Restart
docker start daily-orbit
```

The server reads `tlsCert` and `tlsKey` from encrypted DB config at startup. When both are present, it serves HTTPS on port 443 with an HTTP-to-HTTPS redirect on port 80. When absent, it serves plain HTTP on the configured port (default 9000).

The CORS origin is controlled by the `clientDomain` config field (e.g. `https://dailyorbit.org`).

---

## Makefile Targets

All deployment commands are available as `make` targets:

| Target | Description |
|---|---|
| `make deploy-synth` | Synthesize the CloudFormation template |
| `make deploy-diff` | Show pending infrastructure changes |
| `make deploy-up` | Deploy the stack |
| `make deploy-destroy` | Tear down the stack |
| `make deploy-frontend` | Build frontend, sync to S3, invalidate CloudFront |
| `make deploy-newspaper-images` | Sync local newspaper images to S3, invalidate CloudFront |
| `make deploy-refresh` | Trigger ASG instance refresh (rolling replace) |

### Frontend Deployment

`make deploy-frontend` does three things:

1. Builds the Vite frontend with `VITE_SERVER_URL=https://api.dailyorbit.org`
2. Syncs assets to S3 with immutable cache headers (1 year), except `index.html` which gets `no-cache`
3. Invalidates `/index.html` on CloudFront

### Server Deployment

To deploy a new server version:

1. Build and push the Docker image to ECR
2. Run `make deploy-refresh` to trigger an ASG instance refresh

The refresh terminates the current instance and launches a new one, which auto-deploys via user-data (EIP re-association, S3 restore, Docker pull, etc.).

### Hot Deploy (No CI, No Instance Recycle)

For code-only changes on a running instance, `deploy/hot-deploy.sh` provides a fast (~2 min) deploy path:

```bash
./deploy/hot-deploy.sh
```

This builds the Docker image locally, pushes to ECR, SSHes to the instance, pulls the new image, and restarts the systemd service in-place.

**Limitations:**
- Does **not** invalidate CloudFront — run `make deploy-newspaper-images` or manually invalidate if static assets changed
- Does **not** run `cdk deploy` — IAM/infra changes require a separate `make deploy-up`
- Does **not** survive instance recycle — the systemd unit is patched via `sed`, but a new instance boots with the CI-deployed tag from the launch template
- Tags images as `<version>-hotdeploy-<timestamp>`, not the release version

**When to use:** Quick iteration on server-side code when infrastructure hasn't changed and you don't need CloudFront invalidation. For anything else, use the CI pipeline.

---

## Building and Pushing the Docker Image

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin 665226324657.dkr.ecr.us-east-2.amazonaws.com

# Build for ARM64 (must match instance architecture)
docker buildx build --platform linux/arm64 -t daily-orbit .

# Tag and push
docker tag daily-orbit:latest 665226324657.dkr.ecr.us-east-2.amazonaws.com/daily-orbit:latest
docker push 665226324657.dkr.ecr.us-east-2.amazonaws.com/daily-orbit:latest
```

---

## Data Durability

DuckDB is an in-process database — there is no external database server. Data survives Spot interruptions through the S3 snapshot cycle:

- **Cron** (default: hourly) — Checkpoints WAL, copies DB to S3 as `db/latest.duckdb` and `db/YYYYMMDD-HHMM.duckdb`, syncs attachments
- **Shutdown hook** — Same snapshot runs as a systemd service before halt/reboot, with a 90-second timeout
- **Boot restore** — User-data downloads the latest snapshot from S3 on every instance launch

The ZFS pool provides NVMe-speed I/O with lz4 compression. On instance types without NVMe (e.g. `t4g.micro` for testing), the 30GB EBS root volume is used instead.

---

## Newspaper Images (Static Assets)

Newspaper images (portraits, section headers, hero images, editorial cartoons, house ads) are
served from CloudFront via the frontend S3 bucket under `newspaper/images/`.

### How images reach S3

1. **At generation time (automatic):** When the `newspaperImagesBucket` config key is set,
   the image generators (`./daily-orbit newspaper generate` and `./daily-orbit newspaper generate-library`)
   auto-upload each image to S3 immediately after writing it to local disk. This happens
   during scheduled pipeline runs and manual CLI invocations on the production EC2 instance.

2. **Bulk sync (manual/migration):** To upload all existing local images:
   - From the production container: `./daily-orbit newspaper sync-images`
   - From a dev machine: `make deploy-newspaper-images`

### Configuration

Set the target S3 bucket in the application config (persists in DuckDB, survives deploys):

```bash
./daily-orbit config set newspaperImagesBucket daily-orbit-prod-frontend
```

### URL Routing

| Environment | Image URL pattern | Served by |
|---|---|---|
| Production | `dailyorbit.org/newspaper/images/...` | CloudFront -> S3 |
| Development | `localhost:9000/api/newspaper/images/...` | API server -> local filesystem |

The frontend build uses `VITE_NEWSPAPER_IMAGES_URL=/newspaper` in production (set as a Docker
build arg in `.gitlab-ci.yml`). When unset (dev), it falls back to the API server.

### Cache Behavior

CloudFront has a dedicated cache behavior for `newspaper/images/*`:
- Library images (portraits, headers, masthead, house ads): `immutable`, 1 year TTL
- Edition images (hero, cartoon): 24-hour TTL
- Missing images return real 404 (not SPA fallback)

### Recovery

On instance replacement, local images are lost but all images are in S3. The generators
check the DB for existing records and skip re-generation, so there's no redundant Bedrock
spend. To force re-generation: `./daily-orbit newspaper regenerate --date YYYY-MM-DD`.

---

## SSH Access

```bash
ssh ubuntu@<EIP_ADDRESS>

# Useful commands on the instance:
sudo tail -f /var/log/user-data.log          # boot log
sudo docker logs -f daily-orbit              # app logs
sudo zpool status datapool                   # ZFS health
sudo cat /var/log/db-snapshot.log            # snapshot log
```

The SSH user is `ubuntu` (Ubuntu 24.04 AMI). Requires the key pair specified in the seed config.

---

## Logging

The application uses structured JSON logging in production (`NODE_ENV=production`) via pino. In development, logs are human-readable.

### CloudWatch Log Groups

| Log Group | Source | Content |
|---|---|---|
| `/daily-orbit/app` | Docker container stdout | Structured JSON: HTTP requests, pipeline events, errors |
| `/daily-orbit/user-data` | `/var/log/user-data.log` | Instance bootstrap output |
| `/daily-orbit/db-snapshot` | `/var/log/db-snapshot.log` | Cron and shutdown snapshot output |

### Viewing Logs

```bash
# Tail live application logs
aws logs tail /daily-orbit/app --follow --region us-east-2

# Search for errors in the last hour
aws logs filter-log-events \
  --log-group-name /daily-orbit/app \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern '{ $.level >= 50 }' \
  --region us-east-2
```

---

## File Layout

```
deploy/
  bin/app.ts              CDK app entry point
  lib/
    stack.ts              CDK stack definition
    config.ts             Seed config loader with defaults and validation
    user-data.sh          EC2 user-data template (Ubuntu)
  config/
    aws-EXAMPLE-*.json    Example seed config
    aws-{acct}-{region}-seed.json   Real seed configs (gitignored)
  cdk.json                CDK app config (tsx runner, bootstrap qualifier)
  package.json            CDK dependencies
```
