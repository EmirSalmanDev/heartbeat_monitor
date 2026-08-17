// Named import, not default: ioredis is CJS, and under NodeNext ESM a default
// import resolves to the module namespace object, which has no construct
// signature. Matches how MonitorService.ts already imports it.
import { Redis } from "ioredis";

// Single ioredis instance shared by MonitorService (cache) and QueueService (BullMQ connection).
// BullMQ requires its own connection — QueueService creates a separate ioredis instance
// from the same REDIS_URL so BullMQ can manage its own lifecycle.
export const redis = new Redis(process.env.REDIS_URL!, {
  enableReadyCheck: false,
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});
