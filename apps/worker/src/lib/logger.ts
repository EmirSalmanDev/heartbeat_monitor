import { createLogger } from "@sentinel/shared";

// Module-level singleton, same pattern as lib/prisma.ts and lib/redis.ts.
// Per-job code should use an execution-scoped child (see processors/pingProcessor.ts).
export const logger = createLogger("worker");
