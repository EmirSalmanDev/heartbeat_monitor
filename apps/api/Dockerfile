# -------- BUILD STAGE --------
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack. The version comes from the "packageManager"
# field in package.json, so builder and runner cannot drift from the lockfile.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Copy manifests (for caching)
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# Install all deps (incl. dev)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Generate Prisma client
RUN pnpm --filter @sentinel/db exec prisma generate

# Build packages
RUN pnpm --filter @sentinel/shared build
RUN pnpm --filter @sentinel/api build


# -------- RUNTIME STAGE --------
FROM node:20-alpine AS runner

WORKDIR /app

# Enable pnpm via corepack. The version comes from the "packageManager"
# field in package.json, so builder and runner cannot drift from the lockfile.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Copy manifests from builder (deterministic)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Install prod deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy generated Prisma client and engine files.
# schema.prisma sets `output = "../generated/client"`, so `prisma generate`
# emits the client AND the query engine binary into packages/db/generated —
# nothing is written to node_modules/.prisma. The previous
# `COPY /app/node_modules/.prisma` only ever succeeded because the host's
# node_modules was leaking into the build context via a missing .dockerignore.
COPY --from=builder /app/packages/db/generated ./packages/db/generated

EXPOSE 3001

# Start app
CMD ["node", "apps/api/dist/index.js"]