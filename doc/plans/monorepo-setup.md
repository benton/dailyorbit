# Plan: Merge Templates into Daily Orbit Monorepo

## Context

The project previously had only the `nkzw-tech/web-app-template` frontend code at the repo root.
The companion `nkzw-tech/server-template` (Hono + Better Auth) lives separately.
This plan merges both into a single pnpm monorepo, renames everything to `@daily-orbit/*`,
and replaces the server's Postgres/Prisma/GraphQL stack with DuckDB + REST (per AGENTS.md rules).

---

## Target Monorepo Structure

```
daily-orbit/
├── packages/
│   ├── web/          ← moved from repo root (@daily-orbit/web)
│   └── server/       ← from server-template, adapted (@daily-orbit/server)
├── data/             ← DuckDB database files (gitignored)
├── doc/              ← stays at root
├── AGENTS.md         ← stays at root
├── README.md         ← stays at root
├── LICENSE           ← stays at root
├── pnpm-workspace.yaml
├── package.json      ← root workspace package
├── git-hooks/        ← stays at root (shared)
└── .github/workflows/test.yml
```

---

## Key Decisions

| Decision               | Choice                       | Reason                     |
| ---------------------- | ---------------------------- | -------------------------- |
| HTTP framework         | Hono                         | Lightweight, TS-native     |
| Database               | DuckDB                       | AGENTS.md Bronze Rule      |
| Data access            | Repository pattern + SQL     | AGENTS.md D-1, D-2         |
| API style              | REST via Hono routing        | AGENTS.md Silver Rule      |
| Auth                   | Better Auth                  | Already in both templates  |
| Better Auth DB adapter | Custom (thin DuckDB wrapper) | No official DuckDB adapter |
| Bundler (server prod)  | tsdown (Rolldown-based)      | Fast Rust bundler          |
| TS in dev              | Node 23+ native strip-types  | No ts-node/tsx needed      |

---

## Packages

### `@daily-orbit/web` (`packages/web/`)

The Vite + React + fbtee frontend, moved from repo root.

- **Dev server:** `pnpm --filter @daily-orbit/web dev` → `http://localhost:5173`
- **Build:** `vite build`
- **Tests:** vitest + oxlint + oxfmt + tsgo

### `@daily-orbit/server` (`packages/server/`)

Hono REST API server with DuckDB and Better Auth.

- **Dev server:** `nodemon --exec 'node --no-warnings src/index.ts'` → `http://localhost:9000`
- **Build:** `tsdown` → single ESM bundle in `dist/`
- **Tests:** vitest + oxlint + oxfmt + tsgo

#### Server directory layout

```
packages/server/
├── src/
│   ├── index.ts          ← serve() entry, port 9000
│   ├── app.ts            ← Hono app + route mounting
│   └── lib/
│       ├── auth.ts       ← Better Auth config with custom DuckDB adapter
│       ├── auth-helpers.ts ← buildWhereClause (pure, unit-tested)
│       ├── db.ts         ← DuckDB singleton
│       └── env.ts        ← @nkzw/define-env validation
│   └── user/
│       └── SessionUser.ts
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── oxlint.config.ts
└── .oxfmtrc.jsonc
```

#### Better Auth / DuckDB adapter

Better Auth has no official DuckDB adapter. A custom `Adapter` implementation
(`src/lib/auth.ts`) wraps raw DuckDB prepared statements. The WHERE-clause
builder is extracted into `src/lib/auth-helpers.ts` so it can be unit-tested
independently (no I/O required).

---

## Root workspace scripts

| Script           | Action                                           |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | Start both web + server in parallel              |
| `pnpm test`      | Test both packages in parallel                   |
| `pnpm build`     | Build both packages in parallel                  |
| `pnpm dev:setup` | Run fbtee collect/translate (web) + server no-op |

---

## Environment variables

### `packages/web/.env`

```
VITE_SERVER_URL=http://localhost:9000
```

### `packages/server/.env`

```
DATABASE_URL=data/daily-orbit.duckdb
BETTER_AUTH_SECRET=changeme
BETTER_AUTH_URL=http://localhost:9000
CLIENT_DOMAIN=http://localhost:5173
```

---

## CI (`.github/workflows/test.yml`)

Single job: `pnpm install` → `pnpm dev:setup` → `pnpm test`.
Root `pnpm test` fans out to both packages via `npm-run-all2 --parallel`.
