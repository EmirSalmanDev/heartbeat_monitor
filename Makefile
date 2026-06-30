.PHONY: help dev dev-api dev-worker dev-web build infra migrate studio up down clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  %-14s %s\n", $$1, $$2 }' Makefile

# ── Development ────────────────────────────────────────────────────────────────

dev: ## Start API, worker, and web in parallel 
	@pnpm dev:api & P1=$$!; \
	pnpm dev:worker & P2=$$!; \
	pnpm dev:web & P3=$$!; \
	trap "kill $$P1 $$P2 $$P3 2>/dev/null" INT TERM; \
	wait

dev-api: ## Start API in foreground
	pnpm dev:api

dev-worker: ## Start worker in foreground
	pnpm dev:worker

dev-web: ## Start web in foreground
	pnpm dev:web

# ── Build ───────────────────────────────────────────────────────────────────────

build: ## Build all workspaces
	pnpm build

# ── Infrastructure ──────────────────────────────────────────────────────────────

infra: ## Start Postgres and Redis via Docker Compose
	docker compose up -d redis postgres

up: ## Start full stack via Docker Compose
	docker compose up -d

down: ## Stop and remove Docker Compose containers
	docker compose down

# ── Database ────────────────────────────────────────────────────────────────────

migrate: ## Generate Prisma client and apply migrations
	pnpm db:generate && pnpm db:migrate

studio: ## Open Prisma Studio
	pnpm db:studio

# ── Cleanup ─────────────────────────────────────────────────────────────────────

clean: ## Remove node_modules and dist directories (prompts for confirmation)
	@printf "This will remove node_modules and all dist/ directories. Continue? [y/N] "; \
	read answer; \
	case "$$answer" in \
	  [Yy]*) \
	    docker compose down 2>/dev/null || true; \
	    rm -rf node_modules; \
	    find . -name "dist" -not -path "*/node_modules/*" -maxdepth 5 -type d | xargs rm -rf 2>/dev/null || true; \
	    echo "Done.";; \
	  *) echo "Aborted.";; \
	esac
