# Clean Deployment to Fresh Infrastructure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy v1.14.0 (with CloudFront image support) to clean AWS infrastructure — no existing S3 snapshots, no running instance — and verify the full boot-restore-serve cycle works end-to-end.

**Architecture:** Prepare a production-ready DB copy locally (with prod config values baked in), upload it + key to S3 as the initial snapshot, tag and push to CI, deploy, monitor boot, then generate library assets on the running instance and verify the snapshot cycle preserves everything across an instance recycle.

**Tech Stack:** DuckDB, AWS CLI, GitLab CI, Docker (ARM64), EC2 user-data boot, S3 snapshots, CloudFront

---

## Context

### The Problem

Twice now, restoring a snapshot from S3 has resulted in a production server that fails to boot. The root cause was never determined. This plan treats the deployment as a debugging exercise: every step has explicit verification, and we monitor logs in real time at each stage.

### What We're Starting With

- **Local DB:** `data/daily-orbit.duckdb` (~39 GB) with all application data, dev config values
- **Local key:** `data/daily-orbit.key` (encryption key for config secrets)
- **S3 snapshot bucket:** `daily-orbit-storage` — **empty** (wiped clean)
- **S3 frontend bucket:** `daily-orbit-prod-frontend` — **empty** (wiped clean)
- **ECR:** `665226324657.dkr.ecr.us-east-2.amazonaws.com/daily-orbit` — may have stale images
- **Code:** main branch at v1.14.0, 8 commits ahead of origin (CloudFront images feature)
- **CDK stack:** `daily-orbit-prod` — infrastructure exists (VPC, EIP, ASG, CloudFront, etc.)

### Config Values That Must Change for Production

From the current `config list` output, these keys have dev defaults that must be overridden:

| Key | Current (dev) | Production value |
|-----|---------------|------------------|
| `betterAuthUrl` | `http://localhost:9000` | `https://api.dailyorbit.org` |
| `clientDomain` | `http://localhost:5173` | `https://dailyorbit.org` |
| `bedrockRegion` | `us-east-1` | `us-east-2` |
| `appBaseUrl` | `http://localhost:5173` | `https://dailyorbit.org` |
| `newspaperImagesBucket` | _(empty)_ | `daily-orbit-prod-frontend` |
| `schedulerAutoStart` | `false` | `true` |

These are already correct and don't need changing:
- `snapshotBucket`: `daily-orbit-storage`
- `snapshotPrefix`: `db/`
- `snapshotRegion`: `us-east-2`
- `tlsCert`, `tlsKey`: already set (encrypted)
- `betterAuthSecret`: already set (encrypted)
- All model IDs, prompts, embedding settings: already correct

### Boot Sequence (What user-data.sh Does)

1. Install AWS CLI
2. Associate Elastic IP
3. Set up ZFS on NVMe (or fall back to EBS `/data`)
4. **Restore from S3:** Find newest `db/YYYYMMDD-HHMM.duckdb`, download to `/data/daily-orbit.duckdb`; download `db/daily-orbit.key`; sync `attachments/`
5. Install Docker, pull image from ECR, start container via systemd
6. Install CloudWatch agent
7. Set up shutdown snapshot hook

**Critical:** Step 4 looks for timestamped snapshots matching `db/[0-9]{8}-[0-9]{4}\.duckdb$`. The backup service uploads as `db/YYYYMMDD-HHMM.duckdb`. Our initial upload must match this pattern.

### S3 Snapshot Naming Convention

The backup service (`backup-service.ts`) formats timestamps as:
```
YYYYMMDD-HHMM.duckdb
```
And uploads via the S3 uploader with the configured prefix (`db/`), producing keys like:
```
s3://daily-orbit-storage/db/20260325-1430.duckdb
```

The user-data restore script greps for `db/[0-9]{8}-[0-9]{4}\.duckdb$` and takes the latest by sort.

---

## Task 1: Prepare a production-ready DB copy

Copy the local DB and update config values to production. This is done locally — no network, no risk.

**Step 1: Checkpoint the local DB**

Fold any pending WAL writes so the copy is clean:

```bash
./daily-orbit db checkpoint
```

**Step 2: Copy the DB file**

```bash
cp -v data/daily-orbit.duckdb data/daily-orbit-prod.duckdb
```

**Step 3: Set production config values on the copy**

Run each `config set` against the copy (not the original):

```bash
./daily-orbit config set betterAuthUrl https://api.dailyorbit.org \
  --database data/daily-orbit-prod.duckdb

./daily-orbit config set clientDomain https://dailyorbit.org \
  --database data/daily-orbit-prod.duckdb

./daily-orbit config set bedrockRegion us-east-2 \
  --database data/daily-orbit-prod.duckdb

./daily-orbit config set appBaseUrl https://dailyorbit.org \
  --database data/daily-orbit-prod.duckdb

./daily-orbit config set newspaperImagesBucket daily-orbit-prod-frontend \
  --database data/daily-orbit-prod.duckdb

./daily-orbit config set schedulerAutoStart true \
  --database data/daily-orbit-prod.duckdb
```

**Step 4: Verify the config values**

```bash
./daily-orbit config list --database data/daily-orbit-prod.duckdb
```

Confirm:
- `betterAuthUrl` = `https://api.dailyorbit.org`
- `clientDomain` = `https://dailyorbit.org`
- `bedrockRegion` = `us-east-2`
- `appBaseUrl` = `https://dailyorbit.org`
- `newspaperImagesBucket` = `daily-orbit-prod-frontend`
- `schedulerAutoStart` = `true`
- `tlsCert` and `tlsKey` = `[ENCRYPTED]` (still present from original)
- `snapshotBucket` = `daily-orbit-storage` (unchanged)

---

## Task 2: Upload DB and key to S3 as initial snapshot

The user-data boot script looks for the newest timestamped snapshot. We upload using the naming convention the backup service produces.

**Step 1: Upload the DB with a timestamped key**

Generate a timestamp matching the `YYYYMMDD-HHMM` format and upload:

```bash
TIMESTAMP=$(date -u +%Y%m%d-%H%M)
aws s3 cp data/daily-orbit-prod.duckdb \
  "s3://daily-orbit-storage/db/${TIMESTAMP}.duckdb" \
  --region us-east-2
```

This is a ~39 GB upload. It will take a while. Monitor progress.

**Step 2: Upload the encryption key**

```bash
aws s3 cp data/daily-orbit.key \
  s3://daily-orbit-storage/db/daily-orbit.key \
  --region us-east-2
```

**Step 3: Verify the uploads**

```bash
aws s3 ls s3://daily-orbit-storage/db/ --human-readable --region us-east-2
```

Confirm:
- `db/YYYYMMDD-HHMM.duckdb` exists with ~39 GB size
- `db/daily-orbit.key` exists with ~45 bytes

**Step 4: Verify the boot script would find the snapshot**

Simulate what user-data.sh does:

```bash
aws s3 ls "s3://daily-orbit-storage/db/" --recursive --region us-east-2 \
  | grep -oE 'db/[0-9]{8}-[0-9]{4}\.duckdb$' \
  | sort | tail -1
```

Should output: `db/YYYYMMDD-HHMM.duckdb` (the file we just uploaded).

---

## Task 3: Tag a release and push to CI

**Step 1: Verify all tests pass locally**

```bash
make test
```

All 1030+ tests must pass.

**Step 2: Verify no uncommitted changes (besides plan files)**

```bash
git status
```

The only untracked files should be `doc/plans/*.md`. That's fine — plan files don't go in the release.

**Step 3: Create a fix version tag**

Since we're at v1.14.0 and the code changes are already committed, we tag the current HEAD:

```bash
git tag v1.14.1
```

(Use a patch bump to distinguish from the pre-CloudFront v1.14.0 if it was ever tagged.)

**Step 4: Push the tag and branch to origin**

```bash
git push origin main --tags
```

This triggers the GitLab CI pipeline:
- `test` job: runs `pnpm test`
- `build` job: builds Docker image with `VITE_NEWSPAPER_IMAGES_URL=/newspaper`, pushes to GitLab registry

**Step 5: Monitor CI**

Watch the pipeline at the GitLab project CI/CD page. Both `test` and `build` must pass before the `deploy` job becomes available.

If CI fails:
- Fix the issue
- Commit with `fix(...)` message
- Bump to `v1.14.2`, push again
- Repeat until green

---

## Task 4: Deploy via CI

**Step 1: Click the manual deploy gate in GitLab CI**

The `deploy` job is `when: manual`. Click "Play" once `test` and `build` are green.

The deploy job will:
1. Pull the image from GitLab registry, push to ECR
2. Extract frontend from Docker image, sync to S3 frontend bucket
3. Invalidate CloudFront `/index.html`
4. Trigger ASG instance refresh (`MinHealthyPercentage: 0`)

**Step 2: Confirm the deploy job completes**

Watch the CI job log. All steps should succeed. Note:
- The S3 frontend sync will upload the entire frontend (bucket was empty)
- The ASG refresh will terminate the current instance (if any) and launch a new one

---

## Task 5: Monitor EC2 boot — the critical debugging step

This is where previous deployments have failed. Watch everything.

**Step 1: Find the new instance**

Wait 1-2 minutes for the ASG to launch a new instance, then:

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=daily-orbit" "Name=instance-state-name,Values=running,pending" \
  --query 'Reservations[].Instances[].[InstanceId,LaunchTime,State.Name,PublicIpAddress]' \
  --output table --region us-east-2
```

**Step 2: Watch user-data logs in real time**

Once the instance is running (may take 2-3 min for user-data to start logging):

```bash
aws logs tail /daily-orbit/user-data --follow --region us-east-2
```

Watch for these milestones in order:
1. `=== user-data start` — script began
2. `EIP associated` — networking is up
3. `ZFS pool created` or `using EBS /data` — storage is ready
4. `Restoring newest snapshot: db/YYYYMMDD-HHMM.duckdb` — **this is the critical line**
5. Docker pull and container start

**If step 4 says "FATAL: No timestamped snapshot found":**
- The S3 key pattern didn't match. Check the upload from Task 2.
- SSH into the instance to debug: `ssh ubuntu@api.dailyorbit.org`

**If the download hangs or is very slow:**
- The 39 GB DB is downloading from S3. This takes ~10 minutes on an r6gd.xlarge. Be patient.

**Step 3: Watch application logs**

Once the container starts, switch to app logs:

```bash
aws logs tail /daily-orbit/app --follow --region us-east-2
```

Watch for:
- Server startup message (port 443, HTTPS mode)
- Config service initialization
- Scheduler auto-start (if `schedulerAutoStart` is `true`)

**If the container crashes or restarts:**
- SSH in: `ssh ubuntu@api.dailyorbit.org`
- Check: `sudo docker logs daily-orbit`
- Check: `sudo systemctl status daily-orbit`
- Check: `ls -la /data/daily-orbit.duckdb /data/daily-orbit.key`

**Step 4: Verify the server is reachable**

```bash
curl -sSf https://api.dailyorbit.org/api/health
```

Should return a health check response. If it fails:
- Check if the EIP is associated: `nslookup api.dailyorbit.org`
- Check if TLS is working: `curl -vvv https://api.dailyorbit.org/api/health 2>&1 | head -30`

---

## Task 6: Verify the frontend and images

**Step 1: Check the frontend loads**

Open `https://dailyorbit.org` in a browser. The login page should appear.

**Step 2: Log in and check the newspaper**

Navigate to the newspaper page. At this point:
- **Edition images** (hero, cartoons) may load if they were baked into the DB and the image files were already in S3. More likely, they'll 404 since no images are in the frontend S3 bucket yet.
- **Library images** (portraits, headers, house ads) will 404 — they haven't been uploaded to the frontend bucket.

This is expected. We'll fix it in Task 7.

**Step 3: Verify CloudFront is serving the frontend**

Check response headers:

```bash
curl -sI https://dailyorbit.org | grep -i x-cache
```

Should show: `X-Cache: Hit from cloudfront` (or `Miss` on first request).

---

## Task 7: Generate and upload library assets on production

Library images must be generated on the production instance (DB rows + image files stay together).

**Step 1: SSH into production**

```bash
ssh ubuntu@api.dailyorbit.org
```

**Step 2: Generate library images**

Run inside the Docker container:

```bash
# Section headers
sudo docker exec daily-orbit ./daily-orbit newspaper generate-library --type headers --limit 3

# If that works, generate all headers
sudo docker exec daily-orbit ./daily-orbit newspaper generate-library --type headers

# Portraits (start small to verify)
sudo docker exec daily-orbit ./daily-orbit newspaper generate-library --type portraits --limit 3

# House ads
sudo docker exec daily-orbit ./daily-orbit newspaper generate-library --type house-ads --limit 3
```

Since `newspaperImagesBucket` is set to `daily-orbit-prod-frontend`, the generators will auto-upload each image to S3 immediately after writing to disk.

**Step 3: Verify images are in S3**

```bash
aws s3 ls s3://daily-orbit-prod-frontend/newspaper/images/library/ --recursive --region us-east-2 | head -20
```

**Step 4: Verify images load via CloudFront**

```bash
curl -sI https://dailyorbit.org/newspaper/images/library/headers/three-miles-up.webp | grep -E 'HTTP|x-cache|content-type'
```

Should show `200 OK`, `image/webp`, and `X-Cache: Miss from cloudfront` (first hit) or `Hit from cloudfront`.

**Step 5: Check the newspaper page in browser**

Refresh the newspaper page. Section headers and any generated portraits/house ads should now render.

---

## Task 8: Verify the snapshot cycle

This is the real test — can we recycle the instance and come back clean?

**Step 1: Trigger a manual snapshot**

```bash
sudo docker exec daily-orbit ./daily-orbit db snapshot
```

Watch for: `Snapshot complete` message.

**Step 2: Verify the snapshot landed in S3**

```bash
aws s3 ls s3://daily-orbit-storage/db/ --human-readable --region us-east-2
```

Should show:
- The original upload from Task 2
- A new timestamped snapshot (should be newer)
- `daily-orbit.key`

**Step 3: Wait for the snapshot upload to complete**

The 39 GB upload may take a few minutes. Verify the file size matches:

```bash
aws s3 ls s3://daily-orbit-storage/db/ --human-readable --region us-east-2 | sort | tail -3
```

Both `.duckdb` files should be similar size (~39 GB).

**Step 4: Recycle the instance**

```bash
make deploy-refresh
```

This triggers an ASG instance refresh. The current instance will be terminated and a new one launched.

**Step 5: Monitor the new instance boot (repeat Task 5)**

Watch user-data and app logs. The new instance should:
1. Find the **newest** snapshot (the one from Step 1, not our initial upload)
2. Download it
3. Start the container successfully
4. Serve HTTPS on api.dailyorbit.org

**Step 6: Verify everything survived the recycle**

```bash
# Health check
curl -sSf https://api.dailyorbit.org/api/health

# Frontend
curl -sI https://dailyorbit.org | grep -i x-cache

# Images (still in S3, served by CloudFront — unaffected by instance recycle)
curl -sI https://dailyorbit.org/newspaper/images/library/headers/three-miles-up.webp | grep HTTP
```

Log in and verify the newspaper page still shows all content.

---

## Task 9: Clean up and document

**Step 1: Remove the local prod DB copy**

```bash
rm -v data/daily-orbit-prod.duckdb
```

**Step 2: Note the outcome**

If everything worked, the deployment is verified. If there were issues at any step, document them for the next attempt.

---

## Summary

| # | Task | Where | Risk |
|---|------|-------|------|
| 1 | Prepare prod DB copy | Local | None — operates on a copy |
| 2 | Upload DB + key to S3 | Local → S3 | Slow (~39 GB upload) |
| 3 | Tag and push to CI | Local → GitLab | CI may fail — fix and re-tag |
| 4 | Deploy via CI | GitLab → AWS | Manual gate, reversible |
| 5 | Monitor EC2 boot | AWS (watch logs) | **This is where failures have occurred** |
| 6 | Verify frontend + images | Browser | Read-only verification |
| 7 | Generate library assets on prod | SSH → EC2 | Uses Bedrock quota; use `--limit` first |
| 8 | Verify snapshot cycle | AWS | **Second critical test — recycle and verify** |
| 9 | Clean up | Local | None |

### Failure Modes to Watch For

1. **DB restore fails silently** — user-data continues but container gets a fresh/empty DB instead of the snapshot. Check: `ls -la /data/daily-orbit.duckdb` on the instance (should be ~39 GB, not a few MB).
2. **Key file missing** — encrypted config values (TLS certs, auth secret) can't decrypt. Server will serve HTTP on 9000 instead of HTTPS on 443.
3. **ZFS pool fails to create** — NVMe device detection is fragile. Check: `sudo zpool status datapool`. Fall back to EBS if needed.
4. **Container OOM** — 39 GB DB in DuckDB on an r6gd.xlarge (32 GB RAM). DuckDB memory-maps the file, so RSS will be high but it should work. If it OOMs, reduce to a smaller DB or use a larger instance.
5. **TLS cert expired or mismatched** — Check cert dates: `./daily-orbit config get tlsCert --database data/daily-orbit-prod.duckdb | openssl x509 -noout -dates`

### Rollback

If the deploy fails and the instance won't boot:
- The ASG will keep retrying (min=1). Stop the refresh: `aws autoscaling cancel-instance-refresh --auto-scaling-group-name <name> --region us-east-2`
- Fix the issue, re-upload to S3 if needed, and try again
- The old infrastructure (EIP, CloudFront, S3 buckets) is unaffected
