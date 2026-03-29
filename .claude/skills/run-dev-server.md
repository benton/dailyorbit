---
name: run-dev-server
description: Run the local development servers for rapid iteration
allowed-tools: Read, Grep, Glob, ./daily-orbit, daily-orbit, make
---

If you're on a worktree, pick a pair of ports for the API and VITE servers.
If you're NOT on a worktree, the default ports of `9000` for the API server and `5173` for the VITE server will be used.

- Use `./daily-orbit serve api --watch` to run the API server - it should hot-reload changes
- Use `./daily-orbit serve html` to run the Vite frontend server - it should hot-reload changes
- Use `make test` to run all tests, `make build` for production builds
- The DuckDB CLI is available
- All operational commands (ingest, attachments, companies, news, search, inference, user, config, db) are available via the `./daily-orbit` CLI. Run `./daily-orbit --help` for the full list.
