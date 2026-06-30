# Sentinel — Heartbeat Monitor

HTTP uptime monitor that pings configured URLs on a schedule, stores results in PostgreSQL, caches current status in Redis, and exposes a React dashboard.

## Quick start

```bash
make help          # list all available targets
make infra         # start Postgres + Redis
make migrate       # generate Prisma client + apply migrations
make dev           # start API, worker, and web in parallel
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| Docker | any recent version (for Redis + Postgres) |

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

Copy the example and fill in real values:

```bash
cp .env.example .env
```

Required variables (see `.env.example` for defaults):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | **≥ 32 random characters** — the API refuses to start otherwise |
| `NODE_ENV` | `development` or `production` |
| `PORT` | API port (default `3001`) |

Generate a safe `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start infrastructure

```bash
docker compose up -d redis postgres
```

### 4. Run database migrations

```bash
pnpm db:generate      # generate Prisma client
pnpm db:migrate       # apply migrations (dev only)
```

---

## Run commands

All scripts are in the root `package.json` and delegate to the relevant workspace.

### Development (hot-reload)

Run each in a separate terminal:

```bash
pnpm dev:api        # Express API  →  http://localhost:3001
pnpm dev:worker     # BullMQ worker + metrics server  →  :9091/metrics
pnpm dev:web        # Vite dev server  →  http://localhost:5173
```

### Build all workspaces

```bash
pnpm build
```

> **Note:** There are known pre-existing TypeScript errors in `@sentinel/api` and `@sentinel/worker` related to the ioredis import style and an Express type-inference quirk. These do not affect runtime behaviour. `tsx` (used in dev mode) handles them correctly.

### Start (production)

Each package must be built first, then:

```bash
# API
node apps/api/dist/index.js

# Worker
node apps/worker/dist/index.js

# Web — serve apps/web/dist/ with any static file server or use docker compose
```

Or run the full stack in containers:

```bash
docker compose up -d
```

### Database tooling

```bash
pnpm db:generate     # regenerate Prisma client after schema changes
pnpm db:migrate      # create + apply a new migration (dev)
pnpm db:studio       # open Prisma Studio in browser
```

---

## Redis

### Why Redis is required

Redis serves two distinct purposes, each with its own connection:

| Purpose | Client | Details |
|---------|--------|---------|
| **BullMQ job queue** | `ioredis` (dedicated) | Schedules repeating `ping` jobs in `monitor-queue`; one job per monitor, keyed as `monitor-{id}` |
| **Status cache** | `ioredis` (shared) | Stores the latest check result per monitor at `current_status:{id}` with a 90-second TTL |

BullMQ requires its own connection with `maxRetriesPerRequest: null` — it cannot share the cache connection.

### Start Redis locally (without docker compose)

```bash
docker run -d --name sentinel_redis -p 6379:6379 redis:7-alpine --appendonly yes
```

### Verify it's up

```bash
docker exec sentinel_redis redis-cli ping
# expected: PONG
```

---

## Project structure

```
apps/
  api/        Express REST API (auth, monitor CRUD)
  worker/     BullMQ worker — executes pings, writes results, exposes :9091/metrics
  web/        React + Vite SPA
packages/
  db/         Prisma schema + generated client
  shared/     Zod schemas, error classes, pinger logic (shared across API + worker)
nginx/        nginx config (reverse proxy + /metrics allowlist)
```

---

## Known issues

- **`tsc` build errors in `@sentinel/api` and `@sentinel/worker`:** Five pre-existing errors involving the ioredis default-import style (`TS2351`) and Express router return type inference (`TS2742`). Runtime is unaffected.

- **Docker daemon must be running** before `docker compose up` or any `docker run` command. `pnpm dev:api` will exit immediately if `REDIS_URL` or `DATABASE_URL` are unreachable.

- **`JWT_SECRET` startup guard:** The API calls `process.exit(1)` on startup if `JWT_SECRET` is absent, shorter than 32 characters, or still set to the placeholder from `.env.example`. Set a real secret before running.

- **nginx web build (`corepack`):** The web Dockerfile uses `corepack` to install pnpm. On Node 20.19+ inside Docker, corepack may attempt to download a newer pnpm version and fail. Running `docker compose up -d redis postgres` (skipping nginx/web) avoids this during API/worker development.
