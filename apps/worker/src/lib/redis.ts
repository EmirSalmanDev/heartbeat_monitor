// Named import, not default: ioredis is CJS, and under NodeNext ESM a default
// import resolves to the module namespace object, which has no construct
// signature. Matches how PingService.ts already imports it.
import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!, {
  enableReadyCheck: false,
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});
