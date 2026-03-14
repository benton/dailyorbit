.DEFAULT_GOAL := build

.PHONY: help setup dev test build format clean ingest ingest-dry-run ingest-download attachments attachments-discover attachments-download attachments-reset icfs-ingest icfs-ingest-filing

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Install deps and create .env files
	pnpm install
	cp -n packages/web/.env.example packages/web/.env || true
	cp -n packages/server/.env.example packages/server/.env || true
	mkdir -p packages/server/scripts packages/web/scripts
	pnpm dev:setup

dev: ## Start development server
	pnpm dev

test: ## Run all tests, linting, and type checks
	pnpm test

build: ## Production build
	pnpm build

format: ## Auto-format all packages
	pnpm --filter @daily-orbit/web format
	pnpm --filter @daily-orbit/server format

ingest: ## Load IBFS data from tmp/IBFS/ into DuckDB (pass ARGS for options)
	node --no-warnings packages/server/src/ingest/cli.ts $(ARGS)

ingest-dry-run: ## Validate IBFS data without writing to DB
	node --no-warnings packages/server/src/ingest/cli.ts --dry-run

ingest-download: ## Download IBFS.zip from FCC, extract, and ingest
	node --no-warnings packages/server/src/ingest/cli.ts --download $(ARGS)

attachments: ## Discover and download attachments (pass ARGS for options)
	node --no-warnings packages/server/src/attachments/cli.ts $(ARGS)

attachments-discover: ## Discover attachment metadata only (pass ARGS for options)
	node --no-warnings packages/server/src/attachments/cli.ts --discover-only $(ARGS)

attachments-download: ## Download pending attachments only, skip discovery (pass ARGS for options)
	node --no-warnings packages/server/src/attachments/cli.ts --download-only $(ARGS)

attachments-reset: ## Delete all downloaded attachments and reset DB status to pending
	node --no-warnings packages/server/src/attachments/reset-downloads.ts $(ARGS)

icfs-ingest: ## Ingest filings from ICFS for a date range (requires DATE_FROM, optional DATE_TO)
	node --no-warnings packages/server/src/icfs/cli.ts --date-from $(DATE_FROM) --date-to $(or $(DATE_TO),$(DATE_FROM)) $(ARGS)

icfs-ingest-filing: ## Ingest specific filings from ICFS (requires FILE_NUMBERS)
	node --no-warnings packages/server/src/icfs/cli.ts --file-numbers $(FILE_NUMBERS) $(ARGS)

clean: ## Remove node_modules, build artifacts, and DB files
	rm -rf node_modules packages/*/node_modules packages/*/dist coverage data/*.duckdb
