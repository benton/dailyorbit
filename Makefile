.DEFAULT_GOAL := build

.PHONY: setup dev test build format clean ingest ingest-dry-run

setup:
	pnpm install
	cp -n packages/web/.env.example packages/web/.env || true
	cp -n packages/server/.env.example packages/server/.env || true
	pnpm dev:setup

dev:
	pnpm dev

test:
	pnpm test

build:
	pnpm build

format:
	pnpm --filter @daily-orbit/web format
	pnpm --filter @daily-orbit/server format

ingest:
	node --no-warnings packages/server/src/ingest/cli.ts $(ARGS)

ingest-dry-run:
	node --no-warnings packages/server/src/ingest/cli.ts --dry-run

clean:
	rm -rf node_modules packages/*/node_modules packages/*/dist coverage data/*.duckdb
