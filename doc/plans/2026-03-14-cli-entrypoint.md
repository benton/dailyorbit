# Plan: Unified `daily-orbit` CLI Entrypoint

## Context

Scripts in the project's `scripts/` directory cannot import server modules because ESM ignores `NODE_PATH` — so any script that transitively depends on a server npm package (like `@duckdb/node-api`) fails at runtime. The current workaround is moving scripts into `packages/server/scripts/`, but this is discovered by trial-and-error every time.

Meanwhile, the project has accumulated 4 separate CLI entrypoints (`ingest/cli.ts`, `attachments/cli.ts`, `icfs/cli.ts`, `attachments/reset-downloads.ts`) plus a backfill script, all with duplicated boilerplate for arg parsing, DB connection setup, path resolution, error handling, and graceful shutdown.

A unified CLI solves both problems: everything runs from within the server package context (no import issues), and shared infrastructure eliminates duplication.

## Framework: Citty

[Citty](https://github.com/unjs/citty) (UnJS ecosystem):
- Declarative `defineCommand()` API — closest to Python Click's style
- Zero dependencies, ESM-native, ~3KB
- Built-in nested `subCommands`, typed args, auto-generated help
- Uses Node's native `util.parseArgs` under the hood (what we already use manually)

For colored console output, add `consola` (also UnJS, pairs naturally).

Install: `pnpm --filter @daily-orbit/server add citty consola`

## Command Tree

```
daily-orbit                              # default: start HTTP server
daily-orbit serve                        # explicit: start HTTP server
  --port, -p           Port (default: 9000)

daily-orbit ingest ibfs                  # load IBFS bulk .dat files
  --database           DuckDB path (default: data/daily-orbit.duckdb)
  --ddl                DDL file path (default: tmp/ibfs-schema.txt)
  --dat-dir            .dat directory (default: tmp/IBFS)
  --tables             Comma-separated table names
  --dry-run            Validate only, no writes
  --download           Download IBFS.zip first
  --source-url         Override FTP URL

daily-orbit ingest icfs                  # ingest from ICFS ServiceNow API
  --database           DuckDB path
  --date-from          Start month YYYY-MM
  --date-to            End month YYYY-MM
  --subsystems         Comma-separated codes (default: SAT,SES)
  --app-types          Comma-separated types
  --file-numbers       Specific file numbers (skips discovery)
  --delay              ms between requests (default: 500)

daily-orbit attachments discover         # discover attachment metadata
  --database, --storage-path, --filing, --subsystem,
  --date-from, --date-to, --limit, --delay, --concurrency,
  --provider, --not-scraped-since, --stale-after, --verbose

daily-orbit attachments download         # download pending attachments
  (same scope options as discover, plus --retry-failed)

daily-orbit attachments sync             # discover + download in one pass
  (all options from discover + download)

daily-orbit attachments reset            # delete files, reset DB to pending
  --database           DuckDB path
  --storage-path       Attachment storage path

daily-orbit db query <sql>               # ad-hoc SQL against DuckDB
  --database           DuckDB path
```

## File Layout

All new files under `packages/server/src/`:

```
cli/
  index.ts              # root command: subCommands map, default=serve
  serve.ts              # start Hono HTTP server
  ingest/
    index.ts            # group command (subCommands: ibfs, icfs)
    ibfs.ts             # wraps runIngest() from src/ingest/pipeline.ts
    icfs.ts             # wraps runIcfsIngest() from src/icfs/pipeline.ts
  attachments/
    index.ts            # group command (subCommands: discover, download, sync, reset)
    discover.ts         # wraps runAttachmentPipeline({ discoverOnly: true })
    download.ts         # wraps runAttachmentPipeline({ downloadOnly: true })
    sync.ts             # wraps runAttachmentPipeline({})
    reset.ts            # wraps existing reset logic
  db/
    index.ts            # group command (subCommands: query)
    query.ts            # ad-hoc SQL execution
  shared/
    context.ts          # DB factory, rootDir resolution, env loading
    args.ts             # reusable arg definitions (database, storage-path, scope filters)
bin.ts                  # entrypoint: imports cli/index.ts, calls runMain()
```

## Shared Infrastructure

### `cli/shared/context.ts` — DB factory + path resolution

```typescript
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { trackInstance } from '../../lib/graceful-shutdown.ts';

export const ROOT_DIR: string = resolve(import.meta.dirname, '../../../..');

export function resolveFromRoot(relativePath: string): string {
  return resolve(ROOT_DIR, relativePath);
}

export async function createDb(databasePath: string): Promise<DuckDBInstance> {
  const resolved: string = resolveFromRoot(databasePath);
  const instance: DuckDBInstance = await DuckDBInstance.create(resolved);
  trackInstance(instance);
  return instance;
}
```

### `cli/shared/args.ts` — reusable arg definitions

Common args defined once and spread into command definitions:
- `databaseArg` (--database with default)
- `storagePathArg` (--storage-path with default)
- `scopeArgs` (--filing, --subsystem, --date-from, --date-to, --limit)
- `requestArgs` (--delay, --concurrency)

### `bin.ts` — entrypoint with cleanup

```typescript
import { runMain } from 'citty';
import { main } from './cli/index.ts';
import { closeAll } from './lib/graceful-shutdown.ts';

process.on('exit', closeAll);
runMain(main);
```

## Implementation Phases

### Phase 1: Scaffold (no behavior change)
1. Install `citty` and `consola` in `packages/server/`
2. Create `src/bin.ts` and `src/cli/index.ts` with only the `serve` subcommand
3. Create `src/cli/shared/context.ts` and `src/cli/shared/args.ts`
4. Verify: `node --no-warnings packages/server/src/bin.ts` starts the server
5. Verify: `node --no-warnings packages/server/src/bin.ts serve --port 9001` works
6. Verify: `node --no-warnings packages/server/src/bin.ts --help` shows the command tree

### Phase 2: Wrap existing pipelines
7. Create `src/cli/ingest/ibfs.ts` — thin wrapper calling `runIngest()` from `src/ingest/pipeline.ts`
8. Create `src/cli/ingest/icfs.ts` — thin wrapper calling `runIcfsIngest()` from `src/icfs/pipeline.ts`
9. Create `src/cli/attachments/{discover,download,sync,reset}.ts` — thin wrappers calling `runAttachmentPipeline()` and the reset logic
10. Create `src/cli/db/query.ts` — ad-hoc SQL execution
11. Wire all into `src/cli/index.ts` subcommand tree
12. Test each subcommand against existing behavior

### Phase 3: Update build and Makefile
13. Update `tsdown.config.ts`: add `src/bin.ts` to entry array
14. Add `"bin": { "daily-orbit": "./dist/bin.js" }` to `packages/server/package.json`
15. Update all Makefile targets to use `$(CLI) <subcommand>`:

```makefile
CLI := node --no-warnings packages/server/src/bin.ts

ingest:          $(CLI) ingest ibfs $(ARGS)
ingest-dry-run:  $(CLI) ingest ibfs --dry-run
ingest-download: $(CLI) ingest ibfs --download $(ARGS)
attachments:     $(CLI) attachments sync $(ARGS)
# ... etc
```

### Phase 4: Clean up dead code
16. Delete old CLI entrypoints: `src/ingest/cli.ts`, `src/attachments/cli.ts`, `src/icfs/cli.ts`, `src/attachments/reset-downloads.ts`, `src/attachments/backfill-last-scraped.ts`
17. Move `backfill-last-scraped.ts` logic into a migration if still needed

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/server/package.json` | Add `citty`, `consola` deps; add `bin` field |
| `packages/server/tsdown.config.ts` | Add `src/bin.ts` to entry array |
| `Makefile` | Update all targets to use `$(CLI) <subcommand>` |
| `packages/server/src/ingest/pipeline.ts` | No change (already exports `runIngest()`) |
| `packages/server/src/attachments/pipeline.ts` | No change (already exports `runAttachmentPipeline()`) |
| `packages/server/src/icfs/pipeline.ts` | No change (already exports `runIcfsIngest()`) |
| `packages/server/src/lib/graceful-shutdown.ts` | No change |

## New Files

| File | Purpose |
|------|---------|
| `packages/server/src/bin.ts` | Single entrypoint |
| `packages/server/src/cli/index.ts` | Root command tree |
| `packages/server/src/cli/serve.ts` | Server command |
| `packages/server/src/cli/shared/context.ts` | DB factory, path utils |
| `packages/server/src/cli/shared/args.ts` | Reusable arg defs |
| `packages/server/src/cli/ingest/index.ts` | Ingest group |
| `packages/server/src/cli/ingest/ibfs.ts` | IBFS ingest command |
| `packages/server/src/cli/ingest/icfs.ts` | ICFS ingest command |
| `packages/server/src/cli/attachments/index.ts` | Attachments group |
| `packages/server/src/cli/attachments/discover.ts` | Discover command |
| `packages/server/src/cli/attachments/download.ts` | Download command |
| `packages/server/src/cli/attachments/sync.ts` | Sync command |
| `packages/server/src/cli/attachments/reset.ts` | Reset command |
| `packages/server/src/cli/db/index.ts` | DB group |
| `packages/server/src/cli/db/query.ts` | Query command |

## Files to Delete (Phase 4)

- `packages/server/src/ingest/cli.ts`
- `packages/server/src/attachments/cli.ts`
- `packages/server/src/icfs/cli.ts`
- `packages/server/src/attachments/reset-downloads.ts`
- `packages/server/src/attachments/backfill-last-scraped.ts`

## Verification

After each phase:

1. **Phase 1**: `node --no-warnings packages/server/src/bin.ts --help` shows command tree; `node --no-warnings packages/server/src/bin.ts` starts the server on port 9000
2. **Phase 2**: Run each subcommand and compare output to old CLI:
   - `node --no-warnings packages/server/src/bin.ts ingest ibfs --dry-run`
   - `node --no-warnings packages/server/src/bin.ts attachments discover --subsystem SAT --limit 1`
   - `node --no-warnings packages/server/src/bin.ts db query "SELECT COUNT(*) FROM filing"`
3. **Phase 3**: `make ingest-dry-run`, `make attachments`, etc. all still work; `pnpm build` succeeds
4. **Phase 4**: `pnpm test` passes; old entrypoints are gone; no dead imports
