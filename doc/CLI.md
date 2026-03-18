# CLI Reference

The `daily-orbit` CLI is the single entry point for all server-side operations. It is built with [citty](https://github.com/unjs/citty) and runs directly via Node's native TypeScript support.

```bash
node --no-warnings packages/server/src/bin.ts <command> [options]
```

Run `./daily-orbit --help` to list all available commands.

---

## `daily-orbit serve`

Start application servers. Has two subcommands: `api` and `html`.

### `serve api`

Start the backend API server.

```
daily-orbit serve api [OPTIONS] [DATABASE] [KEYFILE]
```

| Argument/Option | Default | Description |
|---|---|---|
| `DATABASE` | `data/daily-orbit.duckdb` | Path to DuckDB database file |
| `KEYFILE` | `data/daily-orbit.key` | Path to database encryption key file |
| `-p, --port` | `9000` | Port to listen on |

### `serve html`

Start the Vite frontend dev server.

```
daily-orbit serve html [OPTIONS]
```

| Option | Default | Description |
|---|---|---|
| `-p, --port` | `5173` | Port for the Vite dev server |

---

## `daily-orbit config`

Manage application configuration stored in DuckDB.

### `config list`

List all config keys and their current values.

```
daily-orbit config list [--database <path>] [--key-file <path>]
```

### `config get <key>`

Get a single config value.

```
daily-orbit config get <key> [--database <path>] [--key-file <path>]
```

### `config set <key> <value>`

Set a config value.

```
daily-orbit config set <key> <value> [--database <path>] [--key-file <path>]
```

**Common options for all `config` subcommands:**

| Option | Default | Description |
|---|---|---|
| `--database` | `data/daily-orbit.duckdb` | Path to DuckDB database file |
| `--key-file` | `data/daily-orbit.key` | Path to encryption key file |

---

## `daily-orbit ingest`

Data ingestion commands. Two data sources are supported.

### `ingest ibfs`

Load IBFS bulk `.dat` files into DuckDB. This is the legacy FCC data source (frozen since June 2025).

```
daily-orbit ingest ibfs [OPTIONS]
```

| Option | Default | Description |
|---|---|---|
| `--database` | `data/daily-orbit.duckdb` | Path to DuckDB database file |
| `--ddl` | `tmp/ibfs-schema.txt` | Path to Sybase DDL schema file |
| `--dat-dir` | `tmp/IBFS` | Path to extracted `.dat` files directory |
| `--tables` | _(all)_ | Comma-separated table names to load |
| `--dry-run` | `false` | Parse and validate only, no DB writes |
| `--download` | `false` | Download and extract IBFS.zip before ingesting |
| `--source-url` | _(FCC FTP)_ | Override the default FTP URL for the zip download |

### `ingest icfs`

Ingest filings from the ICFS ServiceNow API. This is the current FCC data source (active since June 2025).

```
daily-orbit ingest icfs [OPTIONS]
```

| Option | Default | Description |
|---|---|---|
| `--database` | `data/daily-orbit.duckdb` | Path to DuckDB database file |
| `--date-from` | _(required)_ | Start month `YYYY-MM` (required unless `--file-numbers` given) |
| `--date-to` | _(same as date-from)_ | End month `YYYY-MM` |
| `--subsystems` | `SAT,SES` | Comma-separated subsystem codes |
| `--app-types` | `LOA,MOD,STA,AMD,T/C,ASG,LIC,RWL` | Comma-separated application types |
| `--file-numbers` | _(none)_ | Comma-separated specific file numbers (skips discovery) |
| `--delay` | `500` | Delay between API requests in ms |

**Examples:**

```bash
# Discover and ingest all SAT filings from December 2025
node --no-warnings packages/server/src/bin.ts ingest icfs --date-from 2025-12

# Ingest a specific filing by file number
node --no-warnings packages/server/src/bin.ts ingest icfs --file-numbers SAT-LOA-20250221-00050

# Ingest only STA filings with a 1-second delay
node --no-warnings packages/server/src/bin.ts ingest icfs --date-from 2025-12 --app-types STA --delay 1000
```

---

## `daily-orbit attachments`

Attachment discovery and download commands.

### `attachments discover`

Discover attachment metadata for filings (does not download files).

```
daily-orbit attachments discover [OPTIONS]
```

### `attachments download`

Download pending attachments that have already been discovered.

```
daily-orbit attachments download [OPTIONS]
```

### `attachments sync`

Discover and download attachments in one pass.

```
daily-orbit attachments sync [OPTIONS]
```

### `attachments reset`

Delete downloaded attachment files and reset DB status to pending.

```
daily-orbit attachments reset [OPTIONS]
```

**Common options for `discover`, `download`, and `sync`:**

| Option | Default | Description |
|---|---|---|
| `--database` | `data/daily-orbit.duckdb` | Path to DuckDB database file |
| `--storage-path` | `data/attachments` | Base path for attachment file storage |
| `--filing` | _(none)_ | Comma-separated compact file numbers |
| `--subsystem` | _(none)_ | Comma-separated subsystem codes (`SAT`, `SES`, etc.) |
| `--date-from` | _(none)_ | Start date `YYYY-MM-DD` or `YYYY-MM` |
| `--date-to` | _(none)_ | End date `YYYY-MM-DD` or `YYYY-MM` |
| `--limit` | _(none)_ | Max filings to process |
| `--delay` | `500` | Delay between requests in ms |
| `--concurrency` | `1` | Number of concurrent requests |
| `--provider` | `fcc-report` | Discovery provider: `fcc-report` or `fcc-gov` |
| `--not-scraped-since` | _(none)_ | Only filings not scraped since this ISO timestamp |
| `--stale-after` | _(none)_ | Only filings not scraped within this window (e.g. `7d`, `24h`) |
| `--retry-failed` | `false` | Re-attempt previously failed downloads _(download/sync only)_ |
| `--verbose` | `false` | Log per-filing details |

---

## `daily-orbit db`

Database utility commands.

### `db query`

Run an ad-hoc SQL query against DuckDB.

```
daily-orbit db query <sql>
```

| Argument | Description |
|---|---|
| `sql` | SQL query to execute (required) |

**Examples:**

```bash
# Count filings
node --no-warnings packages/server/src/bin.ts db query "SELECT COUNT(*) FROM filing"

# Check ICFS-ingested filings
node --no-warnings packages/server/src/bin.ts db query "SELECT COUNT(*) FROM filing WHERE icfs_last_fetched_at IS NOT NULL"
```

---

## Global Notes

- **DuckDB single-process constraint:** DuckDB only allows one process to open a database file at a time. CLI commands cannot run while the server is running against the same database. Stop the server first, or use `db query` within the server process.
- **All paths** default to CWD-relative locations (e.g., `data/daily-orbit.duckdb`). Override with `--database` on any command.
- **Help:** Every command supports `--help` for usage details.
