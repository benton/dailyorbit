# Huskynet Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Many tasks here are operational (run on `ed`, AWS console/CLI) rather than code tasks — verify each with the listed check before proceeding.

**Goal:** Move Daily Orbit production hosting from AWS (EC2 Spot + EBS + S3 + CloudFront) to `ed.h.usky.io` on the huskynet, keeping only Bedrock inference, SES email, and Route53 DNS on AWS.

**Architecture:** The existing Docker image (which already serves the frontend via `SERVE_STATIC=true`) runs as a systemd-managed container on `ed`, with `/app/data` on a new ZFS dataset `zp1/dailyorbit`. Caddy on `ed` terminates TLS (Let's Encrypt, automatic) and reverse-proxies `dailyorbit.org` / `www` / `api.dailyorbit.org` to the container on `127.0.0.1:9000`. CI keeps the current tag-triggered pipeline with a manual deploy gate, but the deploy job SSHes to `ed` and restarts the service instead of pushing to ECR/ASG. Images come from the GitLab container registry (`registry.git.h.usky.io`) that the build job already pushes to — ECR drops out entirely.

**Tech Stack:** GitLab CI (self-hosted, git.h.usky.io), Docker, systemd, Caddy, ZFS, DuckDB, AWS CLI (migration only).

**Spec:** This document (motivation + design below). Cost analysis as of 2026-08-22.

## Motivation: July 2026 AWS Cost Analysis (`personal` profile)

Total July 2026: **$269.47** (incl. $11.27 tax). All US regions checked (plus EU/AP — all $0 except eu-west-1 at $0.44).

Daily Orbit attribution (~$234/mo pre-tax, ~91% of the bill):

| Item | July cost | Notes |
| --- | --- | --- |
| S3 storage `daily-orbit-storage` (us-east-2) | ~$157 | **12.3 TiB now** (July avg ~6.8 TiB — growing fast): `attachments/` ≈ 11.7 TiB, `db/` = 672 GB (2 × 336 GB snapshots) |
| S3 requests (us-east-2) | ~$5.6 | Tier1 PUTs from ingest + snapshots |
| EBS gp3 560 GB (60 root + 500 data) | $46.8 | |
| EC2 Spot compute (r7gd.large et al.) | ~$25.6 | |
| Public IPv4 (EIP) | $3.9 | |
| ECR | $2.8 | |
| Bedrock (Nova Pro/Canvas, Haiku, Titan embeddings; us-east-2 + us-east-1) | ~$3.8 | **Stays on AWS** |
| Route53 (1 of 8 zones + queries) | ~$0.6 | **Stays on AWS** |

Not Daily Orbit (~$21): us-west-1 $18.7 (`valheim`/`skyrim` EBS volumes + snapshots, `jacksonroberts.us` S3), us-west-2 $1.6 (old snapshot + Aurora backup), personal-site buckets in us-east-1 (~$0.7).

August MTD (21 days) S3 is already **$173** — on track for ~$255/mo from S3 alone. Post-migration residual AWS spend is ~$55/mo (attachments in Glacier IR ~$48 + Bedrock + Route53 + SES). **Net savings ≈ $190–240/mo and climbing** (attachments stay off-prem; see Design Decisions).

One-time migration egress: DB snapshot ~336 GB ≈ $30 (Phase 1). Attachments never leave AWS — Phase 2 is a lifecycle transition (~$8 one-time), not a transfer.

## Design Decisions

- **Two-phase data move.** Phase 1 moves compute + DB to `ed` and kills EC2/EBS/EIP/ECR/CloudFront (~$85/mo). Attachments stay on `storageBackend=s3` permanently — Phase 2 transitions the 11.7 TiB `attachments/` prefix to **S3 Glacier Instant Retrieval** via a lifecycle rule (~$275/mo → ~$48/mo) instead of moving it on-prem. GIR is a normal S3 GET with millisecond latency plus a $0.03/GB retrieval fee, so the OpenDAL `s3` backend needs **zero code changes**; and since attachment text is already extracted into DuckDB for search/summaries, raw-blob retrievals are rare (a thousand 33 MB document opens ≈ $1/mo). This avoids ~$1,080 of egress, days of transfer, and 12 TiB of on-prem storage that neither `ed` (1.75 TiB pool) nor the NAS (16.77 TiB, would start 70% full and the bucket is growing) can comfortably hold. Optional later: tier objects >1 year old to Deep Archive ($12/mo) once a restore-request UX exists.
- **TLS: no cert to generate.** The current cert is all-AWS (ACM export, stored in DuckDB `tlsCert`/`tlsKey` config). On huskynet, Caddy auto-provisions Let's Encrypt certs. With only 443 port-forwarded, Caddy uses the TLS-ALPN-01 challenge automatically; forwarding 80 as well is recommended (HTTP→HTTPS redirects for stray plain-HTTP hits) but not required. `tlsCert`/`tlsKey` get unset so the Node server serves plain HTTP on 9000 (existing behavior when unset).
- **Frontend from the container.** The image already contains `packages/web/dist` and serves it when `SERVE_STATIC=true` (set in the Dockerfile). CloudFront + frontend bucket become unnecessary. Newspaper images switch to the API-served local-filesystem path (`data/newspaper/images`, the existing dev pattern) by building with `VITE_NEWSPAPER_IMAGES_URL=""` and unsetting `newspaperImagesBucket`.
- **amd64 images.** `ed` is x86_64; CI currently builds arm64-only. The build job goes multi-arch (`linux/amd64,linux/arm64`) during the transition so AWS rollback stays possible; drop arm64 after decommission. amd64 builds natively on the x86 shared runner — the QEMU tax now falls on the arm64 half only.
- **Bridge networking, not `--network host`.** `ed` is a shared box (GitLab, runners). Publish `127.0.0.1:9000:9000` so nothing is exposed beyond Caddy and port collisions are explicit.
- **AWS credentials on `ed`.** No instance profile anymore. A new least-privilege IAM user (`daily-orbit-huskynet`) provides Bedrock invoke, SES send, and S3 access (snapshots + migration reads). Credentials go in the systemd unit's `EnvironmentFile`.
- **Backups, interim.** Keep the in-app S3 snapshot cycle (`snapshotBucket`, retention 2 ≈ $15/mo) plus local ZFS snapshots until the NAS backup process exists; then unset `snapshotBucket` and delete the bucket.
- **Deploy trigger unchanged.** Tag push → pipeline; `deploy` job stays `when: manual` on green `build`+`test`, exactly as today — only its body changes.

## Global Constraints

- Conventional Commits; never mention Claude/Anthropic in commits.
- Domains are unchanged: `dailyorbit.org`, `www.dailyorbit.org`, `api.dailyorbit.org` — so `clientDomain`, `appBaseUrl`, `betterAuthUrl` config stay untouched.
- Never overwrite data from expensive API calls; every migration step must be idempotent/resumable (`aws s3 sync`, not `cp` where possible).
- The production DuckDB file is ~336 GB and grew ~70 GB/mo since April (52 GB → 336 GB); the in-app backup makes a local `.snap` copy before upload, so peak dataset usage is ~2× DB size (~700 GB). `zp1` is 1.75 TiB (2-disk NVMe **stripe — no redundancy**; a single disk failure loses the pool, so off-box backups are load-bearing). Task 2 frees the `/var` zvol's ~880 GB unused refreservation to make room.
- `data/daily-orbit.key` is the encryption key — it must reach `ed` intact (it's in `s3://daily-orbit-storage/db/daily-orbit.key`) and must be in every backup.

## Storage Plan for `ed` (surveyed 2026-08-22)

Hardware: 2× Samsung 970 EVO 1 TB NVMe; `zp1` = 1.75 TiB stripe of the two 898.5 GB `p3` partitions (no redundancy); root is a 32 GB ext4 partition (74% full — don't put anything there); `/var` is a 1 TiB ext4 zvol (`zp1/ROOT/var`, 200 GB used) holding Docker (`/var/lib/docker`). Two AMD SATA controllers have **no drives attached** — free ports for future expansion.

Space math: pool FREE is 1.16 TiB but dataset AVAIL is only **221 GB**, because the `/var` zvol is thick-provisioned (`refreservation=1.03T` against 146 GB actually referenced). Freeing that reservation (Task 2) raises AVAIL to ~1.1 TiB.

Budget for `zp1/ROOT/dailyorbit`: 336 GB live DB + ~336 GB transient `.snap` staging during each in-app backup + newspaper images (~1 GB) ≈ **~700 GB peak**, inside a 900 GB quota. Pool utilization ≈ 54% steady / 74% during backups. At the DB's ~70 GB/mo growth rate this holds ~4–6 months — triggers below.

Consequences and follow-ups:
- The pool is a stripe: one dead NVMe loses everything. The S3 DB snapshot cycle (and later NAS replication) is the real durability story — never disable one before the other exists.
- ZFS snapshots of a churning 336 GB DuckDB file can hold large CoW deltas; keep only 2 dailies (not 7) and monitor `zfs list -o used,usedbysnapshots`.
- Reclaim candidates: `zp1/ROOT/gitlab` is 447 GB — registry cleanup policy + `gitlab-ctl registry-garbage-collect` should shrink it (the CI `buildcache,mode=max` push accumulates there); audit why the DB grew 52→336 GB since April (embeddings/FTS bloat? prunable?).
- Expansion triggers (pool >75–80% or DB >500 GB): add a SATA SSD (2–4 TB, ports are free) as a new pool/vdev for the dailyorbit dataset, or upsize the NVMes.

## Open Questions (answer before Task 4)

1. Is port 9000 free on `ed`? (`ss -tlnp | grep 9000`) If not, pick another and set the app `port` config to match the Caddy upstream.
2. Will port 80 be forwarded alongside 443? (Recommended, not required.)

---

### Task 1: Multi-arch CI build (amd64 + arm64)

**Files:**
- Modify: `.gitlab-ci.yml` (build job, ~line 50)

**Interfaces:**
- Produces: `registry.git.h.usky.io/benton/daily-orbit:<tag>` pullable for `linux/amd64` — consumed by Tasks 6 and 9.

- [ ] **Step 1: Change the buildx platform list and frontend build args**

In the `build` job script, change:

```yaml
    - |
      docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --build-arg VITE_SERVER_URL="$VITE_SERVER_URL" \
        --build-arg VITE_NEWSPAPER_IMAGES_URL="$VITE_NEWSPAPER_IMAGES_URL" \
        --cache-from type=registry,ref=$GL_IMAGE:buildcache \
        --cache-to type=registry,ref=$GL_IMAGE:buildcache,mode=max \
        $TAGS \
        --push \
        .
```

And in `variables`, change `VITE_NEWSPAPER_IMAGES_URL: "/newspaper"` to `VITE_NEWSPAPER_IMAGES_URL: ""` (newspaper images will be served by the API from local disk after cutover; the frontend falls back to the API server when this is empty). `VITE_SERVER_URL` stays `https://api.dailyorbit.org`.

**Note:** This makes tags built from here on huskynet-flavored. The current AWS deploy still works with them (CloudFront serves `/newspaper/images/*` regardless of what the frontend requests; the API fallback path also works on AWS since images exist on the instance).

- [ ] **Step 2: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: build multi-arch images and serve newspaper images from the API"
```

- [ ] **Step 3: Verify with a real pipeline**

Push a tag per the release flow (`/release-version` — bump version, tag, push tag). Confirm in the GitLab UI that `build` is green and the registry shows both architectures:

```bash
docker manifest inspect registry.git.h.usky.io/benton/daily-orbit:v<X.Y.Z> | grep -A2 architecture
```

Expected: entries for `amd64` and `arm64`. (Build will be slower this transition period — amd64 native + arm64 emulated.)

---

### Task 2: Free pool space and prepare the dataset on `ed`

The dataset `zp1/ROOT/dailyorbit` (mountpoint `/zp1/dailyorbit`, lz4) already exists. The work here is reclaiming the `/var` zvol's unused reservation and fencing the dataset with a quota.

- [ ] **Step 1: Confirm the reservation numbers, then free it**

On `ed` (as root):

```bash
zfs get refreservation,volsize,referenced zp1/ROOT/var   # expect refreservation=1.03T, referenced≈146G
zfs set refreservation=none zp1/ROOT/var
```

This makes the zvol sparse: `/var`'s ext4 still believes it has 1 TiB, but unwritten blocks no longer reserve pool space. Caveat: if the pool ever fills completely, writes inside `/var` fail with I/O errors instead of clean ENOSPC — the dailyorbit quota (Step 2) plus pool monitoring is the guard.

- [ ] **Step 2: Quota and layout**

```bash
zfs set quota=900G zp1/ROOT/dailyorbit
mkdir -p /zp1/dailyorbit/newspaper/images
```

- [ ] **Step 3: Verify**

```bash
zfs list -o name,used,avail,quota,compression zp1/ROOT/dailyorbit zp1/ROOT/var
zpool list zp1
```

Expected: dailyorbit AVAIL ≈ 900 GB (quota-bound), pool-level dataset AVAIL ≈ 1.1 TiB, pool CAP ~33%.

---

### Task 3: IAM user + credentials for `ed`

**Files:**
- Create: `deploy/huskynet-iam-policy.json` (checked in, following the `deploy/gitlab-ci-deployer-policy.json` pattern)

- [ ] **Step 1: Write the policy file**

Checked in as `deploy/huskynet-iam-policy.json`. Least-privilege scoping: Bedrock invoke limited to public foundation models + this account's Bedrock resources (covers cross-region/marketplace profiles); SES send limited to the `dailyorbit.org` identity; S3 writes limited to the `db/`, `attachments/`, and `parquet/` prefixes; `s3:DeleteObject` limited to `db/*` (retention pruning) so a leaked key cannot delete the attachment archive; reads bucket-wide plus one-time `daily-orbit-prod-frontend` read for the newspaper-image migration (drop that statement in Task 10).

- [ ] **Step 2: Create user, attach policy, create access key**

```bash
export AWS_PROFILE=personal
aws iam create-user --user-name daily-orbit-huskynet
aws iam put-user-policy --user-name daily-orbit-huskynet \
  --policy-name daily-orbit-huskynet --policy-document file://deploy/huskynet-iam-policy.json
aws iam create-access-key --user-name daily-orbit-huskynet
```

- [ ] **Step 3: Install credentials on `ed`**

```bash
# on ed, as root
install -m 600 /dev/null /zp1/dailyorbit/daily-orbit.env
cat > /zp1/dailyorbit/daily-orbit.env <<'EOF'
AWS_ACCESS_KEY_ID=<from step 2>
AWS_SECRET_ACCESS_KEY=<from step 2>
AWS_REGION=us-east-2
EOF
```

- [ ] **Step 4: Commit the policy file**

```bash
git add deploy/huskynet-iam-policy.json
git commit -m "feat(deploy): IAM policy for huskynet host credentials"
```

---

### Task 4: Initial data seed on `ed` (non-disruptive, production stays up)

- [ ] **Step 1: Pull the latest DB snapshot + key from S3**

On `ed` (aws-cli via Docker keeps the host clean; rerunnable):

```bash
alias aws='docker run --rm --env-file /zp1/dailyorbit/daily-orbit.env -v /zp1/dailyorbit:/data amazon/aws-cli'
aws s3 ls s3://daily-orbit-storage/db/          # pick newest YYYYMMDD-HHMM.duckdb
aws s3 cp s3://daily-orbit-storage/db/<NEWEST>.duckdb /data/daily-orbit.duckdb
aws s3 cp s3://daily-orbit-storage/db/daily-orbit.key /data/daily-orbit.key
```

~336 GB; resumable (re-run `cp` → it restarts, or use `sync` on the `db/` prefix). This is a rehearsal copy — a fresh final snapshot is pulled at cutover (Task 8).

- [ ] **Step 2: Sync newspaper images**

```bash
aws s3 sync s3://daily-orbit-prod-frontend/newspaper/images/ /data/newspaper/images/
```

- [ ] **Step 3: Verify**

```bash
ls -la /zp1/dailyorbit/ && du -sh /zp1/dailyorbit/daily-orbit.duckdb /zp1/dailyorbit/newspaper/images
chown -R 1000:1000 /zp1/dailyorbit   # node user in the container is uid 1000
```

Expected: DB ≈ 336 GB, images present, ownership uid 1000.

---

### Task 5: Container service on `ed` + config re-point

**Interfaces:**
- Produces: `daily-orbit.service` systemd unit on `ed`; app listening on `127.0.0.1:9000`. Consumed by Tasks 6 (Caddy) and 9 (CI deploy `sed`s the image tag in this unit).

- [ ] **Step 1: Registry deploy token + login**

Create a GitLab **deploy token** (read_registry) at `https://git.h.usky.io/benton/daily-orbit/-/settings/repository`. Then on `ed`:

```bash
docker login registry.git.h.usky.io -u <token-username>   # paste token
```

- [ ] **Step 2: Reconfigure the DB copy for huskynet (existing throwaway-container pattern)**

```bash
IMG=registry.git.h.usky.io/benton/daily-orbit:v<X.Y.Z>   # the Task 1 multi-arch tag
docker pull $IMG
alias doconf='docker run --rm --env-file /zp1/dailyorbit/daily-orbit.env -v /zp1/dailyorbit:/app/data $IMG config'
doconf unset tlsCert          # Caddy terminates TLS now
doconf unset tlsKey
doconf unset newspaperImagesBucket   # serve newspaper images from local disk via the API
# Attachments stay on S3 for Phase 1 — verify, don't change:
doconf get storageBackend     # expect: s3
doconf get storageBucket      # expect: daily-orbit-storage
doconf get snapshotBucket     # expect: daily-orbit-storage (interim backups continue)
```

(`clientDomain`, `appBaseUrl`, `betterAuthUrl` are untouched — domains don't change.)

- [ ] **Step 3: Install the systemd unit** (mirrors `deploy/lib/user-data.sh`, with bridge networking + env file)

`/etc/systemd/system/daily-orbit.service` on `ed`:

```ini
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
  -p 127.0.0.1:9000:9000 \
  --log-opt max-size=100m \
  --log-opt max-file=3 \
  --env-file /zp1/dailyorbit/daily-orbit.env \
  -e NODE_ENV=production \
  -v /zp1/dailyorbit:/app/data \
  registry.git.h.usky.io/benton/daily-orbit:v<X.Y.Z>

ExecStop=/usr/bin/docker stop daily-orbit
ExecStopPost=-/usr/bin/docker rm -f daily-orbit

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now daily-orbit
```

- [ ] **Step 4: Verify locally on `ed`**

```bash
curl -fsS http://127.0.0.1:9000/api/health
curl -fsS http://127.0.0.1:9000/ | head -5        # SPA index.html (SERVE_STATIC)
curl -fsSI http://127.0.0.1:9000/api/newspaper/images/library/masthead.webp
journalctl -u daily-orbit -n 50 --no-pager        # no errors; scheduler + FTS index status OK
```

Expected: health 200, HTML served, image 200. Note: the rehearsal DB will drift from production — that's fine until cutover.

---

### Task 6: Caddy proxy entry on `ed`

- [ ] **Step 1: Add the site block** (in `ed`'s Caddyfile, alongside the existing `git.h.usky.io` entries)

```caddyfile
dailyorbit.org, www.dailyorbit.org, api.dailyorbit.org {
	reverse_proxy 127.0.0.1:9000
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

No cert work needed: Caddy issues Let's Encrypt certs automatically once DNS points here (443-only forwarding is fine — TLS-ALPN-01).

- [ ] **Step 2: Pre-cutover verification (before DNS change)**

From outside the LAN (e.g. phone hotspot), resolve manually against the fixed IP:

```bash
curl -fsS --resolve api.dailyorbit.org:443:<FIXED_IP> https://api.dailyorbit.org/api/health
curl -fsS --resolve dailyorbit.org:443:<FIXED_IP> https://dailyorbit.org/ | head -5
```

Expected: 200s with valid certs (Caddy fetches certs on first TLS handshake for a name — the first request may take a few seconds).

---

### Task 7: CI deploy job → deploy to `ed`

**Files:**
- Modify: `.gitlab-ci.yml` (deploy job)

**Interfaces:**
- Consumes: registry image from Task 1; `daily-orbit.service` from Task 5.
- Produces: tag-gated manual deploy exactly as today.

- [ ] **Step 1: Create a deploy user + SSH key on `ed`**

```bash
# on ed, as root
useradd -m -s /bin/bash dailyorbit-deploy
install -d -m 700 -o dailyorbit-deploy ~dailyorbit-deploy/.ssh
ssh-keygen -t ed25519 -N '' -C dailyorbit-ci -f /tmp/dailyorbit-ci
cat /tmp/dailyorbit-ci.pub > ~dailyorbit-deploy/.ssh/authorized_keys
chown dailyorbit-deploy: ~dailyorbit-deploy/.ssh/authorized_keys && chmod 600 ~dailyorbit-deploy/.ssh/authorized_keys
cat > /etc/sudoers.d/dailyorbit-deploy <<'EOF'
dailyorbit-deploy ALL=(root) NOPASSWD: /usr/bin/docker pull *, /usr/bin/sed -i * /etc/systemd/system/daily-orbit.service, /usr/bin/systemctl daemon-reload, /usr/bin/systemctl restart daily-orbit, /usr/bin/systemctl is-active daily-orbit, /usr/bin/journalctl -u daily-orbit *
EOF
```

Add the **private** key as a masked GitLab CI variable `ED_DEPLOY_KEY` (Settings → CI/CD → Variables), and `ED_DEPLOY_HOST=ed.h.usky.io`. Delete `/tmp/dailyorbit-ci*`. The old AWS CI variables (deployer keys) can be removed after decommission.

- [ ] **Step 2: Replace the deploy job body**

```yaml
# ---------------------------------------------------------------------------
# Deploy — tagged releases only, manual gate; deploys to ed (huskynet)
# ---------------------------------------------------------------------------
deploy:
  stage: deploy
  needs: [build, test]
  image: alpine:3.22
  before_script:
    - apk add --no-cache openssh-client curl
    - eval $(ssh-agent -s)
    - echo "$ED_DEPLOY_KEY" | tr -d '\r' | ssh-add -
  script:
    - SANITIZED_TAG=$(echo "$CI_COMMIT_TAG" | sed 's/[^a-zA-Z0-9._-]/-/g')
    - |
      ssh -o StrictHostKeyChecking=accept-new dailyorbit-deploy@$ED_DEPLOY_HOST "
        set -euo pipefail
        sudo docker pull registry.git.h.usky.io/benton/daily-orbit:$SANITIZED_TAG
        sudo sed -i 's|registry.git.h.usky.io/benton/daily-orbit:[^ ]*|registry.git.h.usky.io/benton/daily-orbit:$SANITIZED_TAG|' /etc/systemd/system/daily-orbit.service
        sudo systemctl daemon-reload
        sudo systemctl restart daily-orbit
        sleep 5
        sudo systemctl is-active daily-orbit || { sudo journalctl -u daily-orbit -n 30 --no-pager; exit 1; }
      "
    - curl -fsS --retry 10 --retry-delay 3 --retry-all-errors https://api.dailyorbit.org/api/health
  environment:
    name: production
    url: https://dailyorbit.org
  rules:
    - if: $CI_COMMIT_TAG
      when: manual
      allow_failure: false
```

Also delete the now-unused `ECR_IMAGE` and `FRONTEND_BUCKET` variables (keep `AWS_DEFAULT_REGION` out too), and drop the `docker:27`/dind service from the job as shown.

Note for `ed`'s docker executor runner: the job SSHes to the host, so no privileged/dind needed here. `docker pull` on `ed` uses root's registry login from Task 5 Step 1 (`docker login` as root persists in `/root/.docker/config.json`).

- [ ] **Step 3: Commit (do not push the deploy switch until cutover day)**

```bash
git add .gitlab-ci.yml
git commit -m "ci(deploy): deploy tagged releases to huskynet host via ssh"
```

Keep this on a branch (`feat/huskynet-deploy`) until Task 8 — merging it to main + tagging is the cutover's deploy mechanism.

---

### Task 8: Cutover runbook (one sitting, ~1–2 h; brief downtime is acceptable per current MinHealthyPercentage=0 posture)

- [ ] **Step 1: Lower DNS TTLs** (day before, optional but kind): set `dailyorbit.org`, `www`, `api` A/alias records to TTL 60 in Route53.

- [ ] **Step 2: Freeze production and take the final snapshot**

```bash
ssh ubuntu@api.dailyorbit.org   # key: ~/elaptop/.ssh/id_rsa
sudo docker exec daily-orbit ./daily-orbit db snapshot   # final consistent snapshot to S3
sudo systemctl stop daily-orbit                          # site goes down here
```

- [ ] **Step 3: Pull the final DB onto `ed`** (replaces the rehearsal copy)

```bash
# on ed
systemctl stop daily-orbit
aws s3 ls s3://daily-orbit-storage/db/    # newest timestamp = the Step 2 snapshot
aws s3 cp s3://daily-orbit-storage/db/<FINAL>.duckdb /data/daily-orbit.duckdb   # via the Task 4 alias
aws s3 sync s3://daily-orbit-prod-frontend/newspaper/images/ /data/newspaper/images/
chown -R 1000:1000 /zp1/dailyorbit
```

Re-apply Task 5 Step 2 config changes (the final snapshot restores production config values — `tlsCert`, `newspaperImagesBucket` come back): rerun the `doconf unset` commands.

```bash
systemctl start daily-orbit && curl -fsS http://127.0.0.1:9000/api/health
```

- [ ] **Step 4: Repoint DNS**

In Route53 (console or CLI): `dailyorbit.org` A → `<FIXED_IP>`, `www.dailyorbit.org` A → `<FIXED_IP>`, `api.dailyorbit.org` A → `<FIXED_IP>` (replace the CloudFront aliases and EIP record). **Gotcha:** these records are CDK-managed; changing them manually means the later `deploy-destroy` (Task 10) may delete or fail on them — recheck all three records right after stack destroy and recreate manually if needed.

- [ ] **Step 5: Merge the CI deploy switch and release**

Merge `feat/huskynet-deploy` (Tasks 1+7 changes) to main, then push a release tag (`/release-version` flow). When the pipeline is green, run the manual `deploy` job — it should deploy to `ed`.

- [ ] **Step 6: Full verification**

- `https://dailyorbit.org` loads, newspaper renders with images
- Login works; a search (keyword + vector) returns results
- An attachment opens (proves `storageBackend=s3` path with the new IAM user)
- Admin → AI: run a small inference (proves Bedrock creds)
- Admin → Backups: trigger a snapshot, verify it lands in `s3://daily-orbit-storage/db/` (proves snapshot path)
- Alert email or test email sends (proves SES creds)
- `journalctl -u daily-orbit` clean; overnight: pipeline scheduler ran

- [ ] **Step 7: Interim ZFS snapshot cron on `ed`**

```bash
cat > /etc/cron.daily/dailyorbit-zfs-snapshot <<'EOF'
#!/bin/sh
zfs snapshot zp1/ROOT/dailyorbit@daily-$(date +%Y%m%d)
zfs list -t snapshot -o name -s creation | grep '^zp1/ROOT/dailyorbit@daily-' | head -n -2 | xargs -r -n1 zfs destroy
EOF
chmod +x /etc/cron.daily/dailyorbit-zfs-snapshot
```

(NAS replication replaces/extends this later, per the roadmap note.)

---

### Task 9: Phase 2 — attachments to Glacier Instant Retrieval

`storageBackend=s3` stays; a lifecycle rule moves the ~11.7 TiB `attachments/` prefix to GIR (~$275/mo → ~$48/mo). No egress, no code changes, retrieval stays a normal GET (ms latency, $0.03/GB — negligible at this app's raw-blob access rate). Can run any time after cutover; new attachments from ingest land in Standard and transition after 30 days.

- [ ] **Step 1: Growth audit first** — the bucket grew ~6.8 → 12.3 TiB between July and 2026-08-22. Before paying to store it anywhere, confirm that's legitimate ingest (new filings) and not duplicate uploads: compare `attachment` table counts/sizes in DuckDB against `aws s3 ls --summarize` per service prefix (SAT/, SES/, ITC/…). Prune duplicates if found.

- [ ] **Step 2: Apply the lifecycle rule**

```bash
export AWS_PROFILE=personal
aws s3api put-bucket-lifecycle-configuration --bucket daily-orbit-storage \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "attachments-to-glacier-ir",
      "Status": "Enabled",
      "Filter": {"Prefix": "attachments/"},
      "Transitions": [{"Days": 30, "StorageClass": "GLACIER_IR"}]
    }]
  }'
```

Transition of ~370k existing objects costs ~$8 (one-time) and happens within a day or two of each object passing the age filter — existing objects are all >30 days old, so effectively immediately. Note GIR bills a 90-day minimum per object and a 128 KB minimum size — both fine for an append-only archive of multi-MB documents.

- [ ] **Step 3: Verify** — after the transition shows in the console/`aws s3api head-object` (`StorageClass: GLACIER_IR`), open several attachments across services (SAT, SES, ITC…) in the UI; confirm normal latency. Watch the next month's bill: S3 storage line should drop to ~$50.

- [ ] **Step 4 (optional, later): Deep Archive tier** — once a restore-request UX exists in the storage backend, add a second transition (`Days: 365 → DEEP_ARCHIVE`) to cut storage to ~$12/mo. Not part of this migration.

---

### Task 10: Decommission AWS

After ≥ 1 week stable on huskynet (Phase 1 items) / after Phase 2 (storage):

- [ ] `make deploy-destroy` — removes ASG/EC2, EIP, launch template, CloudFront, frontend bucket, ECR, IAM instance role. Then **verify the three DNS A records survived** (Task 8 Step 4 gotcha) and that the zone itself remains.
- [ ] Delete the orphaned data volume if the stack retained it: `aws ec2 delete-volume --volume-id vol-0283624e12ef2be3a --region us-east-2` (only after confirming the site runs from `ed`'s copy).
- [ ] Delete `daily-orbit-prod-cloudfront-logs` bucket and `cdk-dailyorbit-assets-*` if the stack is gone for good.
- [ ] After NAS backup process exists: `doconf unset snapshotBucket`, delete the `db/` prefix from `s3://daily-orbit-storage`. The bucket itself stays — `attachments/` lives there in Glacier IR permanently.
- [ ] Drop `linux/arm64` from the CI build platform list and remove the leftover binfmt line: `git commit -m "ci: build amd64 only after aws decommission"`.
- [ ] Remove AWS deployer CI variables from GitLab; delete the `gitlab-ci-deployer` IAM user; tighten `daily-orbit-huskynet` policy (drop the `daily-orbit-prod-frontend` read statement; keep `daily-orbit-storage` access — attachments live there permanently).
- [ ] Docs: mark `doc/deployment-aws.md` as historical, write `doc/deployment-huskynet.md` from this plan's end state; update `doc/backups.md` (ZFS/NAS) and `doc/debugging-production.md` (SSH target is now `ed`).
- [ ] Roadmap: add `v?.x.x [ ] NAS backup replication for /zp1/dailyorbit` under Bug fixes/Nice-to-have.

**Not decommissioned (stays on AWS, ~$55/mo):** attachments in `s3://daily-orbit-storage` at Glacier IR (~$48), Bedrock (us-east-2 + us-east-1 Nova Canvas), SES, Route53 zone `dailyorbit.org`, the `daily-orbit-huskynet` IAM user.

## Rollback

Until Task 10, rollback = repoint the three DNS records back (CloudFront aliases + EIP), start the EC2 service (`sudo systemctl start daily-orbit` on the instance), and revert the `.gitlab-ci.yml` deploy job commit. Images are multi-arch, so tags built during the transition run on both targets. The S3 data is untouched until the very last step.
