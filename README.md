# Sentinel — Heartbeat Monitor

HTTP uptime monitor that pings configured URLs on a schedule, stores results in
PostgreSQL, caches the latest status in Redis, and exposes a React dashboard —
with a full metrics/logs stack (Prometheus, Loki, Grafana) alongside it.

**Stack:** React + Vite SPA served by Nginx · Express + TypeScript API ·
Prisma + PostgreSQL · Redis + BullMQ · pnpm workspaces monorepo · Docker
Compose · Prometheus + Loki + Grafana Alloy + Grafana · pino structured
logging.

---

## Architecture

| Container | Role |
| --- | --- |
| `postgres` | Primary datastore — users, monitors, checks, alerts |
| `redis` | BullMQ job queue **and** cache-aside store for the latest check result |
| `migrate` | One-shot `prisma migrate deploy`, then exits; `api`/`worker` wait for it to succeed |
| `api` | Express REST API — auth, monitor CRUD, JSON logs, `/metrics` |
| `worker` | BullMQ worker — executes scheduled pings, writes results, exposes `/metrics` on `:9091` |
| `nginx` | Reverse proxy + static SPA host — the only container the outside world talks to for app traffic |
| `prometheus` | TSDB + remote-write receiver + query API (no scrape config of its own — see Observability) |
| `loki` | Log storage, queried by Grafana |
| `alloy` | Single collector — scrapes `api`/`worker` metrics and remote-writes to Prometheus; tails container logs and pushes to Loki |
| `grafana` | Dashboards — Prometheus + Loki pre-provisioned as datasources, "Sentinel Overview" dashboard pre-provisioned |

**Request flow (app path):**

```
Browser
  │  http://localhost/  (same origin, port 80)
  ▼
Nginx
  │  /            → static SPA build
  │  /api/*       → proxied to api:3001, prefix stripped, rate-limited
  ▼
API (Express)
  │  auth, monitor CRUD                 │  on monitor create/update:
  ▼                                     ▼
PostgreSQL                        Redis — BullMQ queue (bull:monitor-queue:*)
  ▲                                     │
  │  Check rows                        ▼
  └───────────────────────────── Worker (BullMQ consumer, pings on schedule)
                                        │
                                        ▼
                              Redis — cache-aside key
                              current_status:{monitorId}, TTL 90s
```

**Key decisions:**

- **JWT in an HTTP-only cookie.** The API never hands the SPA a token to store
  in JS-reachable storage; the cookie (`token`) is signed with `JWT_SECRET`
  and verified per-request in `authMiddleware`.
- **Same origin via Nginx.** The SPA and API are both served from
  `http://localhost/`, with `/api/*` proxied and prefix-stripped — no CORS
  configuration needed or present.
- **Class-based services with constructor DI** (`AuthService`,
  `MonitorService`, `QueueService`, `MetricsService`) — dependencies (Prisma
  client, Redis client, logger) are passed in explicitly rather than imported
  ad hoc, aside from the handful of true process-wide singletons
  (`lib/prisma.ts`, `lib/redis.ts`, `lib/logger.ts`).
- **Zod at the boundary.** Every request body is parsed with a Zod schema
  (`packages/shared/src/schemas.ts`) before it reaches a service, including an
  SSRF guard that rejects monitor URLs pointing at localhost, private IPv4/IPv6
  ranges, or the Docker service names on `sentinel_net`.
- **`AppError` + `asyncHandler` + `errorHandler`.** Route handlers throw typed
  errors (`ValidationError`, `NotFoundError`, `ForbiddenError`, …);
  `asyncHandler` forwards any rejection to `next()`; one global `errorHandler`
  turns every error — including Zod errors and unmatched routes — into the
  same `{ success: false, error: { code, message } }` shape.
- **Redis does two unrelated jobs on purpose.** BullMQ owns the queue
  (`bull:monitor-queue:*`, its own `ioredis` connection with
  `maxRetriesPerRequest: null`), and a separate cache-aside key
  `current_status:{monitorId}` (90s TTL) holds the latest check result so
  `GET /monitors` doesn't hit Postgres for status on every request.

---

## Monorepo structure

```
apps/
  api/        Express REST API (auth, monitor CRUD, metrics, structured logs)
  worker/     BullMQ worker — pings, writes results, exposes :9091/metrics
  web/        React + Vite SPA
packages/
  db/         Prisma schema + generated client
  shared/     Zod schemas, error classes, pinger logic, logger factory
nginx/        Nginx config (reverse proxy, SPA fallback, rate limiting, /metrics block)
observability/
  prometheus.yml            Prometheus config (receiver only, no scrape_configs)
  loki-config.yaml          Loki config (filesystem storage, 14d retention)
  config.alloy              Alloy pipeline: metrics scrape + remote_write, log tail + push
  grafana/
    provisioning/datasources/  Prometheus + Loki datasource provisioning
    provisioning/dashboards/   Dashboard file-provider config
    dashboards/sentinel.json   The "Sentinel Overview" dashboard
```

---

## Getting started

### 1. Environment variables

```bash
cp .env.example .env
```

Fill in real values for `POSTGRES_PASSWORD`, `JWT_SECRET` (≥ 32 random
characters — the API refuses to start otherwise), `COOKIE_SECRET`, and
`GRAFANA_ADMIN_PASSWORD`. Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Start everything

```bash
docker compose up -d --build
```

This builds `api`, `worker`, and `nginx`, runs `migrate` once, then starts the
full stack.

### 3. Exposed URLs

| URL | What |
| --- | --- |
| `http://localhost/` | SPA + API (via Nginx, `/api/*`) |
| `http://localhost:3000` | Grafana (`admin` / `$GRAFANA_ADMIN_PASSWORD`) |
| `http://localhost:12345` | Alloy debug UI (scrape target health) |
| `localhost:5432` | Postgres (published directly — see Security notes) |
| `localhost:6379` | Redis (published directly — see Security notes) |

`api` (3001) and `worker` (9091) are **not** published to the host — they're
reachable only on the internal `sentinel_net` network, or through Nginx for
the API.

### 4. Stop / reset

```bash
docker compose down        # stop and remove containers; named volumes (data) persist
docker compose down -v     # full reset — also removes postgres/redis/prometheus/loki/grafana volumes
```

For local hot-reload development without Docker (`pnpm dev:api`,
`pnpm dev:worker`, `pnpm dev:web`, or the equivalent `make dev*` targets), see
the scripts in the root `package.json` and `Makefile` — you'll still need
`docker compose up -d redis postgres` for infrastructure.

---

## Observability

**Data flow:** `api` and `worker` each expose `/metrics` (Prometheus text
format) and write structured JSON logs (pino) to stdout. Alloy — one
collector, one config file (`observability/config.alloy`) — scrapes both
`/metrics` endpoints and remote-writes the samples into Prometheus
(`/api/v1/write`); separately, it tails the Docker log streams of `api`,
`worker`, and `nginx` and pushes them to Loki. Grafana reads both, with the
"Sentinel Overview" dashboard pre-provisioned.

**Design decisions:**

- **Alloy scrapes; Prometheus has no `scrape_configs`.** One collector
  handles metrics *and* logs instead of running a separate exporter and log
  shipper. Prometheus (`observability/prometheus.yml`) is started with
  `--web.enable-remote-write-receiver` (see its command in
  `docker-compose.yml`) and acts purely as an ingest + TSDB + query API.
  **Trade-off:** Prometheus's own `/targets` / `/api/v1/targets` will always be
  empty — that's expected, not a broken scrape. Target health lives in the
  Alloy debug UI at `http://localhost:12345` instead.
- **Loki, and `requestId` as structured metadata, not a label.** Every API
  request gets a `requestId` bound to its logger
  (`apps/api/src/middleware/requestLogger.ts`). If Alloy indexed that as a
  Loki stream label, every single request would mint its own stream and blow
  up cardinality. Instead only `level` and `service` are stream labels;
  `requestId` (plus `executionId`, `jobId`, `monitorId`, `route`,
  `statusCode`) ride along as structured metadata — filterable in Grafana
  without touching the index.
- **`/api/metrics` is blocked at Nginx** (403 — see `nginx/nginx.conf`).
  Alloy already reaches `api:3001/metrics` and `worker:9091/metrics` directly
  over the internal `sentinel_net` network; `/metrics` has no auth of its own,
  so nothing legitimate needs it exposed publicly.
- **Grafana is provisioned as code.** Both datasources and the dashboard are
  file-provisioned (`observability/grafana/provisioning/**`) with
  `editable: false` / `allowUiUpdates: false`. The `grafana_data` volume is
  disposable — `docker compose down -v` wipes it, and the next `up`
  reprovisions identically from source.
- **`sentinel_ping_total` has no `monitor_id` label** — dropped deliberately
  (see `apps/worker/src/services/MetricsService.ts`) because one label value
  per monitor would mean one time series per monitor, unbounded as monitors
  are created. It only carries `status`. Consequence: every ping panel on the
  dashboard is **aggregated across all monitors** — there's no per-monitor
  ping chart in Prometheus/Grafana today; per-monitor history lives in
  Postgres via `GET /monitors/:id/checks`.

**Custom metrics** (from the live `/metrics` output):

| Metric | Type | Labels | Emitted by |
| --- | --- | --- | --- |
| `sentinel_http_requests_total` | counter | `method`, `route`, `status_code` | `api` |
| `sentinel_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | `api` |
| `sentinel_http_requests_in_flight` | gauge | (none) | `api` |
| `sentinel_ping_total` | counter | `status` (`UP`/`DOWN`) | `worker` |
| `sentinel_ping_latency_seconds` | histogram | (none) | `worker` |
| `up` | gauge | `job`, `instance`, `service` | generated by Alloy's scrape, per target — not app-emitted |

---

## Verification commands

```bash
docker compose ps                                              # all containers up, postgres/redis "(healthy)"

curl -s http://localhost/api/health                             # {"status":"ok",...}

docker exec sentinel_redis redis-cli TTL "current_status:<monitorId>"   # ≤ 90, once a monitor has pinged

docker exec sentinel_prometheus wget -qO- \
  "http://localhost:9090/api/v1/query?query=sentinel_ping_total"        # real samples once a monitor exists
```

---

## Known limitations

- No CI/CD — there is no `.github/` workflow in this repo.
- No lint or test scripts in any workspace's `package.json`.
- No notification delivery. `Alert`/`AlertType` exist in the Prisma schema,
  but nothing in `apps/api` or `apps/worker` creates or sends one — it's
  schema-only, reserved for a future feature.
- No BullMQ queue-depth or job-count metric. The worker only exports
  `sentinel_ping_total` / `sentinel_ping_latency_seconds`; the dashboard's
  "Worker Job Throughput" panel uses the ping counter's rate as a proxy, not a
  true queue-depth gauge.

---

## Production security notes

- **Change every default secret** in `.env` before deploying anywhere but
  localhost: `POSTGRES_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`, and
  `GRAFANA_ADMIN_PASSWORD` all ship as placeholders in `.env.example`.
- **Don't publish `postgres` (5432) or `redis` (6379)** beyond localhost —
  `docker-compose.yml` maps both straight to the host for local convenience.
  The same applies to the Alloy debug UI (12345) and Grafana (3000) in any
  shared or multi-tenant environment.
- **`/api/metrics` is blocked at Nginx** (403) — `/metrics` carries no
  authentication, so it must never be reachable from outside the Docker
  network. Alloy reaches it internally instead.
- **Set `NODE_ENV=production`** in any real deployment — the auth cookie's
  `secure` flag is only enabled when `NODE_ENV === "production"`.
