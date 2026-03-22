.DEFAULT_GOAL := build

.PHONY: help setup dev test build format clean \
       deploy-synth deploy-diff deploy-up deploy-destroy deploy-frontend deploy-refresh

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

FRONTEND_BUCKET := daily-orbit-prod-frontend
VITE_SERVER_URL := https://api.dailyorbit.org

deploy-frontend: ## Build and deploy frontend to CloudFront
	VITE_SERVER_URL=$(VITE_SERVER_URL) pnpm --filter @daily-orbit/web build
	aws s3 sync packages/web/dist/ s3://$(FRONTEND_BUCKET)/ \
		--delete \
		--cache-control "public,max-age=31536000,immutable" \
		--exclude "index.html"
	aws s3 cp packages/web/dist/index.html s3://$(FRONTEND_BUCKET)/index.html \
		--cache-control "no-cache"
	aws cloudfront create-invalidation \
		--distribution-id "$$(aws cloudfront list-distributions \
			--query 'DistributionList.Items[?Aliases.Items[0]==`dailyorbit.org`].Id | [0]' \
			--output text)" \
		--paths "/index.html"

deploy-refresh: ## Trigger ASG instance refresh (rolling replace)
	aws autoscaling start-instance-refresh \
		--auto-scaling-group-name "$$(aws autoscaling describe-auto-scaling-groups \
			--query 'AutoScalingGroups[?Tags[?Key==`Project`&&Value==`daily-orbit`]].AutoScalingGroupName | [0]' \
			--output text)" \
		--preferences '{"MinHealthyPercentage": 0}'
