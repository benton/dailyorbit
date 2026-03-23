# Structured Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace raw `console.log/error/warn` with a structured logger that outputs JSON in production (for CloudWatch), human-readable in development, and ship all logs from EC2 to CloudWatch Logs via the unified CloudWatch agent.

**Architecture:** Introduce `pino` as the application logger. A thin `logger.ts` module creates a singleton logger that outputs JSON when `NODE_ENV=production` and pretty-printed text otherwise. All timestamps are ISO 8601. On the infrastructure side, install the Amazon CloudWatch agent in user-data.sh and grant the EC2 role CloudWatch Logs permissions.

**Tech Stack:** pino (structured logging), amazon-cloudwatch-agent (log shipping), aws-cdk-lib (IAM + SSM)

---

## Task 1: Add pino dependency and create logger module

**Files:**
- Modify: `packages/server/package.json` (add `pino` dependency)
- Create: `packages/server/src/lib/logger.ts`
- Test: `packages/server/src/lib/logger.test.ts`

**Step 1: Install pino**

```bash
cd packages/server && pnpm add pino
```

**Step 2: Write the failing test**

Create `packages/server/src/lib/logger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createLogger, type AppLogger } from './logger.ts';

describe('createLogger', () => {
  it('returns a pino logger with expected methods', () => {
    const log: AppLogger = createLogger({ env: 'test' });
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('outputs JSON when env is production', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    log.info({ event: 'test' }, 'hello');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('time');
    expect(parsed).toHaveProperty('msg', 'hello');
    expect(parsed).toHaveProperty('event', 'test');
  });

  it('includes ISO 8601 timestamp in JSON output', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    log.info('timestamp check');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(typeof parsed.time).toBe('string');
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates child loggers with bound context', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    const child: AppLogger = log.child({ module: 'pipeline' });
    child.info('stage started');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('module', 'pipeline');
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
cd /Users/benton/code/daily-orbit && pnpm --filter @daily-orbit/server exec vitest run src/lib/logger.test.ts
```

Expected: FAIL — `./logger.ts` does not exist.

**Step 4: Implement the logger module**

Create `packages/server/src/lib/logger.ts`:

```typescript
import pino, { type Logger, type DestinationStream } from 'pino';

export type AppLogger = Logger;

export type LoggerOptions = {
  env?: string;
  destination?: DestinationStream;
};

export function createLogger(options: LoggerOptions = {}): AppLogger {
  const env: string = options.env ?? process.env.NODE_ENV ?? 'development';
  const isProduction: boolean = env === 'production';

  const transport: pino.TransportSingleOptions | undefined =
    !isProduction && !options.destination
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined;

  return pino(
    {
      level: 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(transport ? { transport } : {}),
    },
    options.destination,
  );
}

/** Singleton logger for the application. */
let _logger: AppLogger | undefined;

export function getLogger(): AppLogger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

export function setLogger(logger: AppLogger): void {
  _logger = logger;
}
```

**Step 5: Run tests to verify they pass**

```bash
cd /Users/benton/code/daily-orbit && pnpm --filter @daily-orbit/server exec vitest run src/lib/logger.test.ts
```

Expected: PASS

**Step 6: Commit**

```
feat: add structured logger module with pino
```

---

## Task 2: Replace console.log in API server startup

**Files:**
- Modify: `packages/server/src/cli/serve/api.ts`

**Step 1: Import the logger and replace console calls**

Replace all `console.log`, `console.error`, `console.warn` in `api.ts` with the logger:

```typescript
import { createLogger, setLogger, type AppLogger } from '../../lib/logger.ts';
```

Early in the `run()` function (before any logging), create and set the logger:

```typescript
const log: AppLogger = createLogger();
setLogger(log);
```

Then replace:
- `console.log(...)` → `log.info(...)`
- `console.error(...)` → `log.error(...)`
- `console.warn(...)` → `log.warn(...)`

For structured messages, convert string interpolations to pino's object-first style:
- `console.log(\`Server running at http://localhost:${port}\`)` → `log.info({ port }, 'Server started')`
- `console.log(\`Database: ${dbPath}\`)` → `log.info({ dbPath }, 'Database loaded')`

**Step 2: Run the full test suite to verify nothing breaks**

```bash
cd /Users/benton/code/daily-orbit && make test
```

**Step 3: Manual smoke test**

```bash
cd /Users/benton/code/daily-orbit && NODE_ENV=production ./daily-orbit serve api 2>&1 | head -5
```

Verify output is JSON with `time`, `level`, `msg` fields.

**Step 4: Commit**

```
refactor: use structured logger in API server startup
```

---

## Task 3: Replace console.log in pipeline runner

**Files:**
- Modify: `packages/server/src/pipeline/runner.ts`

**Step 1: Import the logger**

```typescript
import { getLogger } from '../lib/logger.ts';
```

**Step 2: Replace console output in the log() method**

In the `log()` helper (around line 405-408), replace:

```typescript
const fn: (msg: string) => void =
  level === 'error' ? console.error : console.log;
fn(`[pipeline:${stage}] ${message}`);
```

with:

```typescript
const logger = getLogger();
if (level === 'error') {
  logger.error({ stage, runId: this.state.runId }, message);
} else {
  logger.info({ stage, runId: this.state.runId }, message);
}
```

**Step 3: Run pipeline tests**

```bash
cd /Users/benton/code/daily-orbit && pnpm --filter @daily-orbit/server exec vitest run src/pipeline/
```

**Step 4: Commit**

```
refactor: use structured logger in pipeline runner
```

---

## Task 4: Replace console.log across remaining server modules

**Files:**
- Modify: all files under `packages/server/src/` that still use `console.log/error/warn`

**Step 1: Find all remaining console usage**

```bash
cd /Users/benton/code/daily-orbit && rg 'console\.(log|error|warn)' packages/server/src/ --files-with-matches
```

**Step 2: Replace in each file**

For each file, import `getLogger` and replace console calls. Use structured context objects where useful:

- CLI commands (ingest, config, etc.): use `getLogger()` — these are fine with simple `log.info(message)` since they're user-facing CLI output
- Service layer: `getLogger().child({ module: 'service-name' })` for context
- Middleware: `getLogger().child({ module: 'auth' })` etc.

**Important**: Do NOT change `console.table()` calls in CLI display code — those are intentional tabular output for terminal users and are not "logging". Similarly, keep `console.log` in purely CLI-output paths (formatters, table printers) where the output is the product, not a log message.

**Step 3: Run full test suite**

```bash
cd /Users/benton/code/daily-orbit && make test
```

**Step 4: Commit**

```
refactor: replace console logging with pino across server
```

---

## Task 5: Add HTTP request logging middleware

**Files:**
- Create: `packages/server/src/lib/request-logger.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/lib/request-logger.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/lib/request-logger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestLogger } from './request-logger.ts';
import { createLogger, type AppLogger } from './logger.ts';

describe('requestLogger middleware', () => {
  it('logs method, path, status, and duration', async () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });

    const app: Hono = new Hono();
    app.use('*', requestLogger(log));
    app.get('/api/test', (c) => c.json({ ok: true }));

    const res: Response = await app.request('/api/test');
    expect(res.status).toBe(200);
    expect(chunks.length).toBe(1);

    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('method', 'GET');
    expect(parsed).toHaveProperty('path', '/api/test');
    expect(parsed).toHaveProperty('status', 200);
    expect(parsed).toHaveProperty('durationMs');
    expect(typeof parsed.durationMs).toBe('number');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/benton/code/daily-orbit && pnpm --filter @daily-orbit/server exec vitest run src/lib/request-logger.test.ts
```

**Step 3: Implement the middleware**

Create `packages/server/src/lib/request-logger.ts`:

```typescript
import type { MiddlewareHandler } from 'hono';
import type { AppLogger } from './logger.ts';

export function requestLogger(logger: AppLogger): MiddlewareHandler {
  const log: AppLogger = logger.child({ module: 'http' });

  return async (c, next) => {
    const start: number = Date.now();
    await next();
    const durationMs: number = Date.now() - start;

    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      },
      'request',
    );
  };
}
```

**Step 4: Wire into app.ts**

Add the middleware early in `app.ts`, after CORS but before routes:

```typescript
import { requestLogger } from './lib/request-logger.ts';
import { getLogger } from './lib/logger.ts';

// After CORS setup:
app.use('*', requestLogger(getLogger()));
```

Skip logging for `/api/health` to avoid noise — add an early return in the middleware or filter in the middleware itself.

**Step 5: Run tests**

```bash
cd /Users/benton/code/daily-orbit && make test
```

**Step 6: Commit**

```
feat: add HTTP request logging middleware
```

---

## Task 6: Remove unused consola dependency

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Verify consola is unused**

```bash
cd /Users/benton/code/daily-orbit && rg "from ['\"]consola" packages/server/src/
```

Expected: no results.

**Step 2: Remove it**

```bash
cd packages/server && pnpm remove consola
```

**Step 3: Commit**

```
chore: remove unused consola dependency
```

---

## Task 7: Add CloudWatch Logs IAM permissions to CDK stack

**Files:**
- Modify: `deploy/lib/stack.ts`

**Step 1: Add CloudWatch Logs permissions to the instance role**

After the existing SES policy statement (around line 128), add:

```typescript
// CloudWatch Logs for structured log shipping
instanceRole.addToPolicy(
  new iam.PolicyStatement({
    actions: [
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'logs:DescribeLogStreams',
    ],
    resources: ['*'],
  }),
);
```

**Step 2: Run CDK synth to verify**

```bash
cd /Users/benton/code/daily-orbit && make deploy-synth
```

**Step 3: Commit**

```
feat(deploy): add CloudWatch Logs IAM permissions to instance role
```

---

## Task 8: Install CloudWatch agent and configure log shipping in user-data.sh

**Files:**
- Modify: `deploy/lib/user-data.sh`

**Step 1: Add CloudWatch agent installation after Docker setup**

Insert a new section after the Docker container launch (after line 84) and before the snapshot cron (line 86):

```bash
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
```

**Step 2: Configure Docker to use json-file logging with timestamps**

The Docker `json-file` log driver (the default) already writes JSON with timestamps to `/var/lib/docker/containers/*/`. Since our app now outputs structured JSON via pino, the CloudWatch agent will collect it as-is. No changes needed to the `docker run` command.

However, add `--log-opt max-size=100m --log-opt max-file=3` to the docker run command to prevent unbounded log growth on ephemeral storage:

In the `docker run` command (line 78-84), add log options:

```bash
docker run -d \
  --name daily-orbit \
  --restart unless-stopped \
  --network host \
  --log-opt max-size=100m \
  --log-opt max-file=3 \
  -v /data:/app/data \
  -e NODE_ENV=production \
  {{ECR_URI}}:{{CONTAINER_TAG}}
```

**Step 3: Run CDK synth to verify template renders**

```bash
cd /Users/benton/code/daily-orbit && make deploy-synth
```

**Step 4: Commit**

```
feat(deploy): install CloudWatch agent and ship app/system logs
```

---

## Task 9: Update deployment documentation

**Files:**
- Modify: `doc/deployment-aws.md`

**Step 1: Update the Instance Boot Sequence section**

Add a step between Docker (step 5) and Snapshot cron (step 6):

> 6. **CloudWatch agent** — Install the unified CloudWatch agent, configure it to ship container logs (`/daily-orbit/app`), user-data logs (`/daily-orbit/user-data`), and snapshot logs (`/daily-orbit/db-snapshot`) to CloudWatch Logs.

Renumber subsequent steps (cron → 7, shutdown hook → 8).

**Step 2: Add a Logging section**

After the SSH Access section, add:

```markdown
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
```

**Step 3: Update the CDK Stack Resources section**

Add to the IAM bullet:
> CloudWatch Logs (create log groups/streams, put events)

**Step 4: Commit**

```
docs: document structured logging and CloudWatch integration
```

---

## Task 10: Log and display software version on admin dashboard

**Files:**
- Modify: `packages/server/src/stats/routes.ts` (add version to admin stats response)
- Modify: `packages/server/src/stats/stats-service.ts` or the stats query file (add version to DatasetStats)
- Modify: `packages/web/src/admin/Dashboard.tsx` (display version)
- Modify: `packages/server/src/cli/serve/api.ts` (log version at startup)

**Step 1: Add version to the startup log**

In `api.ts`, after logger creation, read the version from package.json and include it in the startup log line:

```typescript
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Read version from package.json (available at build time)
const pkg: { version: string } = JSON.parse(
  readFileSync(resolve(import.meta.dirname ?? '.', '../../package.json'), 'utf-8'),
);
const version: string = pkg.version;

log.info({ version }, 'Daily Orbit starting');
```

Also include version in the server-started log line:

```typescript
log.info({ port, version }, 'Server started');
```

**Step 2: Expose version in the /api/health endpoint**

Modify `app.ts` health check to include the version:

```typescript
app.get('/api/health', (c) => c.json({ status: 'ok', version: process.env.APP_VERSION ?? 'dev' }));
```

Set `APP_VERSION` in the Docker run command from the package.json version (or bake it into the image). Simpler approach: read it from package.json at module load time in app.ts, same as above.

**Step 3: Add version to admin stats response**

In the admin stats route handler, include the version in the response alongside the existing `DatasetStats`:

```typescript
// In stats/routes.ts, the /api/admin/stats handler:
const stats = await getDatasetStats(conn, getDbPath());
return c.json({ ...stats, version });
```

**Step 4: Display version on the admin dashboard**

In `packages/web/src/admin/Dashboard.tsx`, add a version display. Add it to the stats cards row as a simple text element, or in the page header area:

```tsx
{stats.version && (
  <p className="text-sm text-muted-foreground">
    Server v{stats.version}
  </p>
)}
```

Place it near the top of the dashboard, next to or below the "Admin Dashboard" heading.

**Step 5: Update the DatasetStats type**

Add `version: string` to the shared `DatasetStats` type definition so both frontend and backend agree on the shape.

**Step 6: Run tests and verify**

```bash
cd /Users/benton/code/daily-orbit && make test
```

Manual check: visit `/admin` and confirm version is displayed.

**Step 7: Commit**

```
feat: display software version on admin dashboard and in startup logs
```

---

## Summary of Changes

| Area | Before | After |
|---|---|---|
| **App logging** | Raw `console.log/error/warn`, no timestamps | pino: JSON in prod, pretty in dev, ISO 8601 timestamps |
| **HTTP request logs** | None | Middleware logs method, path, status, duration |
| **Log shipping** | SSH + `docker logs` only | CloudWatch agent ships all logs to 3 log groups |
| **IAM** | No CloudWatch perms | `logs:CreateLogGroup`, `PutLogEvents`, etc. |
| **Dependencies** | consola (unused) | pino (active), consola removed |
| **Version display** | Not visible | Logged at startup, shown on admin dashboard, in /api/health |
