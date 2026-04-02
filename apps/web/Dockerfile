# ── Stage 1: build ──────────────────────────────────────────────────
FROM node:20.19-alpine AS builder
WORKDIR /app

RUN corepack enable

# Manifest
COPY tsconfig.base.json ./
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json        ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/web        ./apps/web

RUN pnpm --filter @sentinel/shared build

RUN pnpm --filter @sentinel/web build
# Output: /app/apps/web/dist

# ── Stage 2: serve ───────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]