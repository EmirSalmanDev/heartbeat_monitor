# -------- BUILD STAGE --------
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy manifests (for caching)
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/

# Install all deps (incl. dev)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

# Generate Prisma client
RUN pnpm --filter @sentinel/db exec prisma generate

# Build packages
RUN pnpm --filter @sentinel/shared build
RUN pnpm --filter @sentinel/worker build


# -------- RUNTIME STAGE --------
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy manifests from builder (deterministic)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/apps/worker/package.json ./apps/worker/

# Install prod deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Copy generated Prisma client and engine files
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Start worker
EXPOSE 9091
CMD ["node", "apps/worker/dist/index.js"]