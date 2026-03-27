Prepare for a production debugging session on Daily Orbit.

## Step 1: Load context

Read the following files to understand the production environment:
- `doc/debugging-production.md` — Production debugging guide
- `doc/deployment-aws.md` — AWS architecture and deployment details
- `packages/server/debugscripts/cwl-queries.json` — Available CloudWatch Logs Insights queries

## Step 2: Check current production health

Run these in parallel:
1. `curl -sf https://api.dailyorbit.org/api/health` — Is the API responding?
2. `python3 packages/server/debugscripts/cwl-query.py errors --hours 24` — Recent errors
3. `python3 packages/server/debugscripts/cwl-query.py non-http --hours 24` — Recent app events (backup, pipeline)

## Step 3: Present a status summary

Report to the user:
- Whether the API is healthy
- Any errors or warnings in the last 24 hours, grouped by type
- Backup status (last successful snapshot)
- Any anomalies in app events

Then ask: **"What issue are you investigating?"**

## Step 4: Investigate

Based on the user's answer, use the appropriate debugging tools:

- **Log queries**: `python3 packages/server/debugscripts/cwl-query.py <query> [--hours N] [--arg VALUE] [--format json|csv]`
- **Remote scripts**: `packages/server/debugscripts/run_in_prod.sh <script> [args]`
- **DuckDB queries on the instance**: Edit `packages/server/debugscripts/debug_ec2_instance.sh`, then run it with `run_in_prod.sh`
- **API checks**: `curl` against `https://api.dailyorbit.org/api/...`
- **SSH**: `ssh ubuntu@api.dailyorbit.org` for interactive investigation

### Important rules:
- **Download log data ONCE** and analyze locally — don't run repeated queries against CloudWatch
- Save downloaded samples to `packages/server/debugscripts/samples/` for offline analysis
- Write analysis scripts in Python rather than chaining shell commands
- When querying DuckDB on the instance, always **copy the DB first** (the app holds a write lock)
- If a code fix is needed, use `/hot-deploy` to ship it fast
