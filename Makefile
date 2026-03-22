.DEFAULT_GOAL := build

.PHONY: help setup dev test build format clean \
       deploy-synth deploy-diff deploy-up deploy-destroy deploy-seed-secrets

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

clean: ## Remove node_modules, build artifacts, and DB files
	rm -rf node_modules packages/*/node_modules packages/*/dist coverage data/*.duckdb

# ── Deployment ────────────────────────────────────────────────────
CDK_DIR := deploy

deploy-synth: ## Synthesize CloudFormation template
	cd $(CDK_DIR) && pnpm cdk synth

deploy-diff: ## Show pending infrastructure changes
	cd $(CDK_DIR) && pnpm cdk diff

deploy-up: ## Deploy the stack
	cd $(CDK_DIR) && pnpm cdk deploy

deploy-destroy: ## Tear down the stack
	cd $(CDK_DIR) && pnpm cdk destroy

deploy-seed-secrets: ## Upload TLS cert+key to Secrets Manager (CERT=... KEY=...)
	aws secretsmanager put-secret-value \
		--secret-id daily-orbit/tls-cert \
		--secret-string "$$(cat $(CERT))"
	aws secretsmanager put-secret-value \
		--secret-id daily-orbit/tls-key \
		--secret-string "$$(cat $(KEY))"
