# Production Debugging Guide

This guide covers how to investigate and fix issues on the live Daily Orbit deployment (`api.dailyorbit.org`).

---

## Architecture Quick Reference

```
                    ┌──────────────┐
dailyorbit.org ────>│  CloudFront  │──> S3 (frontend bucket)
                    └──────────────┘

                    ┌──────────────┐
api.dailyorbit.org─>│  Elastic IP  │──> EC2 Spot (Ubuntu 24.04 ARM64)
                    └──────────────┘    ├── Docker: daily-orbit container
                                        ├── ZFS on NVMe ephemeral storage
                                        └── /data: DuckDB + attachments
```

- **Single EC2 instance** in a Spot ASG (min=1, max=1)
- **DuckDB** — single-process, file-based database at `/data/daily-orbit.duckdb`
- **S3 snapshots** — DB and attachments backed up every 2 hours + on shutdown
- **CloudWatch Logs** — structured JSON logs shipped via the CloudWatch agent

---

## 1. Log Access

### CloudWatch Log Groups

| Log Group                | Content                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `/daily-orbit/app`       | Application logs (HTTP requests, pipeline, backup, errors) |
| `/daily-orbit/user-data` | Instance bootstrap output (plain text)                     |

### Log Structure (3 layers of nesting)

Application logs are triple-wrapped:

```
CloudWatch event  →  { timestamp, message, ingestionTime }
  Docker JSON     →  { log: "<pino json>", stream: "stdout", time: "..." }
    Pino JSON     →  { level, time, pid, hostname, msg, ... }
```

CloudWatch auto-parses the Docker layer. The `log` field is available directly, but Pino fields inside it must be extracted with regex `parse` statements in Insights queries.

#### Pino Fields

**All records:** `level`, `time`, `pid`, `hostname`, `msg`

**HTTP requests** (msg="request"): `module`, `method`, `path`, `status`, `durationMs`

**App events** (backup, pipeline, startup): `error?`, `stage?`, `runId?`, `localPath?`

**Pino levels:** 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal

### CLI Query Tool

The `cwl-query.py` script in `packages/server/debugscripts/` runs pre-built Insights queries:

```bash
# List available queries
python3 packages/server/debugscripts/cwl-query.py --list

# Recent errors and warnings (last 7 days)
python3 packages/server/debugscripts/cwl-query.py errors --hours 168

# Slow requests (> 500ms)
python3 packages/server/debugscripts/cwl-query.py slow --hours 6

# Top API paths by hit count with latency stats
python3 packages/server/debugscripts/cwl-query.py top-paths --hours 24

# HTTP status code breakdown
python3 packages/server/debugscripts/cwl-query.py status-codes --hours 24

# Search for a specific path
python3 packages/server/debugscripts/cwl-query.py path --arg /api/filings --hours 6

# Free-text search across all logs
python3 packages/server/debugscripts/cwl-query.py search --arg "backup" --hours 48

# Non-HTTP events (backup, pipeline, startup)
python3 packages/server/debugscripts/cwl-query.py non-http --hours 24

# Request traffic volume per 5-minute bin
python3 packages/server/debugscripts/cwl-query.py traffic --hours 6

# Output as CSV
python3 packages/server/debugscripts/cwl-query.py errors --hours 24 --format csv
```

Query definitions live in `packages/server/debugscripts/cwl-queries.json`. The same file is deployed as saved queries in the CloudWatch Console via CDK.

### Tailing Live Logs

```bash
# Via AWS CLI
aws logs tail /daily-orbit/app --follow --region us-east-2

# Via SSH (journalctl)
ssh ubuntu@api.dailyorbit.org 'sudo journalctl -fu daily-orbit.service'
```

---

## 2. SSH Access

**IMPORTANT**: DON'T use SSH to access the production server directly. Use _only_ the following two actions to interact with the produciton server:

1. Edit the script `packages/server/debugscripts/debug_ec2_instance.sh`
2. Run the script on the server. From the main project directory, run :
   `packages/server/debugscripts/run_in_prod.sh packages/server/debugscripts/debug_ec2_instance.sh [args]`

### Useful Instance Commands

Put these in `packages/server/debugscripts/debug_ec2_instance.sh` as needed...

```bash
# Service status
sudo systemctl status daily-orbit

# Container status
sudo docker ps --filter name=daily-orbit

# Live app logs
sudo docker logs -f daily-orbit --tail 100

# Boot log
sudo tail -f /var/log/user-data.log

# ZFS health (NVMe instances)
sudo zpool status datapool

# Disk usage
df -h /data

# DuckDB file size
ls -lh /data/daily-orbit.duckdb

# Run a DuckDB query (copy first — the app holds a lock)
sudo cp -pv /data/daily-orbit.duckdb /tmp/query.duckdb
duckdb /tmp/query.duckdb "SELECT count(*) FROM filing"
```

### Available Tools on the Instance

- `duckdb` CLI (v1.5.1)
- `python3` + `uv` (for ad-hoc Python scripts)
- `docker` (the app runs as a container)
- Standard Ubuntu tools

---

## 3. Common Debugging Scenarios

### App returns 404 for a filing that should exist

```bash
# Check if the filing exists in the database
ssh ubuntu@api.dailyorbit.org \
  'sudo cp /data/daily-orbit.duckdb /tmp/q.duckdb && \
   duckdb /tmp/q.duckdb "SELECT file_number, status FROM filing WHERE file_number = '\''SAT-LOA-20240701-00011'\''"'

# Check recent 404s in the logs
python3 packages/server/debugscripts/cwl-query.py path --arg "/api/filings" --hours 24 | \
  python3 -c "import json,sys; [print(r) for r in json.load(sys.stdin) if r.get('status')=='404']"
```

### Pipeline or news fetch failures

```bash
# Check non-HTTP app events
python3 packages/server/debugscripts/cwl-query.py non-http --hours 24

# Search for specific pipeline stage
python3 packages/server/debugscripts/cwl-query.py search --arg "news.fetch" --hours 48
```

### Backup failures

```bash
# Check backup-related logs
python3 packages/server/debugscripts/cwl-query.py search --arg "backup" --hours 48

# Check backup status via API
curl -s https://api.dailyorbit.org/api/admin/backups/status | python3 -m json.tool

# List recent snapshots in S3
aws s3 ls s3://daily-orbit-storage/db/ --region us-east-2 | tail -10
```

### Spot instance replacement

If the instance was replaced (Spot interruption or ASG refresh):

1. The shutdown hook triggers a DB snapshot to S3
2. A new instance boots, runs user-data, and restores from S3
3. Check `/daily-orbit/user-data` logs for the new instance's boot progress
4. Any data written between the last periodic snapshot and the shutdown hook may be lost if the hook's 90-second timeout was exceeded

```bash
# Check latest snapshot age
aws s3 ls s3://daily-orbit-storage/db/ --region us-east-2 | grep -E '^\d{8}-\d{4}' | tail -1
```

---

## 4. Restarting and Recovering

### Restart the container (preserves data)

```bash
packages/server/debugscripts/run_in_prod.sh server_systemctl.sh restart
```

### Hot deploy a code fix

```bash
# Build, push, and deploy without recycling the instance
./deploy/hot-deploy.sh
```

### Force instance recycle (full re-provision from S3)

```bash
make deploy-refresh
```

This terminates the current instance and launches a fresh one from the latest snapshot.

### Trigger a manual backup

```bash
curl -X POST https://api.dailyorbit.org/api/admin/backups/trigger
```

---

## 6. Key Constraints

- **DuckDB is single-process** — only one process can write at a time. Copy the DB before querying on the instance.
- **Spot instance** — can be interrupted with 2-minute warning. The shutdown hook tries to snapshot, but data between the last snapshot and interruption may be lost.
- **No load balancer** — TLS terminates in Node.js. If the container is down, the site is down.
- **42GB database** — S3 restore takes ~10 minutes on boot. This is the main source of deploy downtime.
