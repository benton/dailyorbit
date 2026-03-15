# Configuration

All application configuration is stored in the DuckDB database's `config` table. Only two filesystem paths are needed to start the server: the database file and the encryption key file.

## Quick start

```bash
# Fresh start — creates DB, key file, and seeds defaults automatically
make serve

# View current config
make config-list

# Change a value
node --no-warnings packages/server/src/bin.ts config set clientDomain https://my-domain.com

# Read a single value (decrypts secrets for display)
node --no-warnings packages/server/src/bin.ts config get betterAuthUrl
```

## How it works

On first launch (`make serve`), the server:

1. Creates `data/daily-orbit.duckdb` and `data/daily-orbit.key`
2. Generates a 256-bit AES encryption key and writes it to the key file (mode `0600`)
3. Initializes the database schema, including the `config` table
4. Seeds all config keys with their default values (auto-generating `betterAuthSecret`)

On subsequent launches, the server reads the key file, opens the database, loads all config into an in-memory cache, and initializes auth.

## Config keys

| Key | Default | Encrypted | Description |
|-----|---------|-----------|-------------|
| `betterAuthSecret` | _(auto-generated)_ | Yes | Auth secret used by Better Auth for session signing |
| `betterAuthUrl` | `http://localhost:9000` | No | Base URL of the auth service |
| `clientDomain` | `http://localhost:5173` | No | Frontend origin for CORS |

## Encryption

Sensitive config values are encrypted at rest using AES-256-GCM. The encryption key lives in a separate file (`data/daily-orbit.key` by default) that is **not** stored in the database.

- The key file contains a base64-encoded 256-bit key
- Each encrypted value stores `base64(IV || authTag || ciphertext)` in the `config.value` column
- A random 12-byte IV is generated per write, so repeated writes of the same plaintext produce different ciphertexts
- The `config.encrypted` boolean column tracks which values need decryption on read

### SecretValue wrapper

In application code, encrypted config values are returned as `SecretValue` instances rather than plain strings. This prevents accidental logging:

```typescript
const secret = config.get('betterAuthSecret');
// secret instanceof SecretValue → true

console.log(secret);           // "[ENCRYPTED]"
console.log(`key: ${secret}`); // "key: [ENCRYPTED]"
JSON.stringify({ s: secret }); // '{"s":"[ENCRYPTED]"}'

secret.unwrap();               // returns the actual plaintext
```

Call `.unwrap()` explicitly when the real value is needed (e.g. passing to Better Auth).

## Environment variables that remain outside the DB

Some values cannot move to the database because they are consumed at build time or before the application starts:

| Variable | Reason |
|----------|--------|
| `NODE_ENV` | Read by the Node.js runtime before app code executes |
| `VITE_SERVER_URL` | Baked into the frontend bundle at build time by Vite |
| `SERVE_STATIC` | When `true`, the API server serves the built frontend from `packages/web/dist/`. Set automatically in the Docker image. Must **not** be set during development, where Vite runs separately with hot-reload. |
| `--port` flag | CLI argument for the serve command (default `9000`) — deployment-specific |

These stay as traditional environment variables or CLI flags.

## CLI reference

All config commands accept optional `--database` and `--keyFile` flags (defaults: `data/daily-orbit.duckdb` and `data/daily-orbit.key`).

```
daily-orbit config list              # Show all keys, values, defaults, and descriptions
daily-orbit config get <key>         # Print one value (decrypts secrets)
daily-orbit config set <key> <value> # Update one value (encrypts if needed)
```

## File layout

```
data/
  daily-orbit.duckdb   # Database (contains config table + all app data)
  daily-orbit.key      # Encryption key (base64, mode 0600)
```

Both files must be present together, or neither (for fresh initialization). If one exists without the other, the server exits with an error.
