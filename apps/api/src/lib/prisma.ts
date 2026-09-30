import { PrismaClient, Prisma } from "@sentinel/db";
import { logger } from "./logger.js";

// Event-based logging rather than Prisma's stdout logging: `log: ["query"]`
// makes Prisma print plain text ("prisma:query SELECT 1") straight to stdout,
// bypassing pino entirely, so those lines reach Loki unparseable and invisible
// to any JSON-field query. Emitting events instead lets every line go out as
// structured JSON through the app logger.
export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ],
});

// Queries are high-volume and uninteresting at default verbosity — debug, so
// they are off unless LOG_LEVEL is lowered.
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
