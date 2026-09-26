import { PrismaClient, Prisma } from "@sentinel/db";
import { logger } from "./logger.js";

// Same rationale as apps/api/src/lib/prisma.ts: Prisma's stdout logging emits
// plain text that bypasses pino. Events route it through the worker logger so
// every line the container writes is structured JSON.
export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ],
});

// Debug, not info: the ping loop issues a write per monitor per interval, so at
// info these would drown every other line in the worker's log.
prisma.$on("query", (e: Prisma.QueryEvent) => {
  logger.debug(
    { query: e.query, params: e.params, durationMs: e.duration },
    "Prisma query",
  );
});

prisma.$on("error", (e: Prisma.LogEvent) => {
  logger.error({ err: e }, "Prisma error");
});

prisma.$on("warn", (e: Prisma.LogEvent) => {
  logger.warn({ msg: e.message }, "Prisma warning");
});
