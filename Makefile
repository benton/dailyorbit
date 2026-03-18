.DEFAULT_GOAL := build

CLI := node --no-warnings packages/server/src/bin.ts

.PHONY: help setup dev test build format clean ingest ingest-dry-run ingest-download attachments attachments-discover attachments-download attachments-validate attachments-extract attachments-reset icfs-ingest icfs-ingest-filing db-query db-remediate-html config-list companies-seed companies-attribute companies-stats companies-extract-ownership companies-enrich search-rebuild-index embed embed-all user-create user-disable user-delete user-reset-password

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Install deps and prepare directories
	pnpm install
	cp -n packages/web/.env.example packages/web/.env || true
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
	$(CLI) ingest ibfs $(ARGS)

ingest-dry-run: ## Validate IBFS data without writing to DB
	$(CLI) ingest ibfs --dry-run

ingest-download: ## Download IBFS.zip from FCC, extract, and ingest
	$(CLI) ingest ibfs --download $(ARGS)

attachments: ## Discover and download attachments (pass ARGS for options)
	$(CLI) attachments sync $(ARGS)

attachments-discover: ## Discover attachment metadata only (pass ARGS for options)
	$(CLI) attachments discover $(ARGS)

attachments-download: ## Download pending attachments only, skip discovery (pass ARGS for options)
	$(CLI) attachments download $(ARGS)

attachments-extract-cookies: ## Extract ICFS session cookies via browser login
	$(CLI) attachments extract-cookies $(ARGS)

attachments-download-auth: ## Download ServiceNow attachments with auth cookies
	$(CLI) attachments download --auth-cookies data/icfs-cookies.json --retry-failed $(ARGS)

attachments-validate: ## Validate content types of downloaded attachments via file magic
	$(CLI) attachments validate $(ARGS)

attachments-extract: ## Extract text from downloaded attachments (PDF, text, CSV)
	$(CLI) attachments extract $(ARGS)

attachments-reset: ## Delete all downloaded attachments and reset DB status to pending
	$(CLI) attachments reset $(ARGS)

icfs-ingest: ## Ingest filings from ICFS for a date range (requires DATE_FROM, optional DATE_TO)
	$(CLI) ingest icfs --date-from $(DATE_FROM) --date-to $(or $(DATE_TO),$(DATE_FROM)) $(ARGS)

icfs-ingest-filing: ## Ingest specific filings from ICFS (requires FILE_NUMBERS)
	$(CLI) ingest icfs --file-numbers $(FILE_NUMBERS) $(ARGS)

db-query: ## Run ad-hoc SQL query (requires SQL="...")
	$(CLI) db query "$(SQL)"

db-remediate-html: ## Convert HTML strings to Markdown in pleadings/filings/attachments
	$(CLI) db remediate-html $(ARGS)

config-list: ## Show all config keys and values
	$(CLI) config list

companies-seed: ## Seed company data from built-in satellite industry dataset
	$(CLI) companies seed $(ARGS)

companies-attribute: ## Run batch attribution of filings to companies
	$(CLI) companies attribute $(ARGS)

companies-stats: ## Show company attribution coverage statistics
	$(CLI) companies stats $(ARGS)

companies-extract-ownership: ## Extract ownership events from T/C and ASG filings
	$(CLI) companies extract-ownership $(ARGS)

companies-enrich: ## Enrich company data from GLEIF and Wikidata
	$(CLI) companies enrich $(ARGS)

search-rebuild-index: ## Rebuild all full-text search indexes
	$(CLI) search rebuild-index $(ARGS)

embed: ## Generate vector embeddings for a single source (requires SOURCE=filing|attachment|pleading)
	$(CLI) inference embed --source $(SOURCE) $(ARGS)

embed-all: ## Generate vector embeddings for all sources
	$(CLI) inference embed --source all $(ARGS)

user-create: ## Create a new user account (pass ARGS for options)
	$(CLI) user create $(ARGS)

user-disable: ## Disable a user account (pass ARGS for options)
	$(CLI) user disable $(ARGS)

user-delete: ## Delete a user account permanently (pass ARGS for options)
	$(CLI) user delete $(ARGS)

user-reset-password: ## Reset a user's password (pass ARGS for options)
	$(CLI) user reset-password $(ARGS)

clean: ## Remove node_modules, build artifacts, and DB files
	rm -rf node_modules packages/*/node_modules packages/*/dist coverage data/*.duckdb
