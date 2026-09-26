import { createLogger } from "@sentinel/shared";

// Module-level singleton, same pattern as lib/prisma.ts and lib/redis.ts.
// Request handlers should not import this directly — they get a request-scoped
// child logger (with requestId already bound) via req.log instead.
export const logger = createLogger("api");
