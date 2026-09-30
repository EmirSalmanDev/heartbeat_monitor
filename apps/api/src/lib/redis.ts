import { Redis } from "ioredis";
import { logger } from "./logger.js";

// Single ioredis instance shared by MonitorService (cache) and QueueService (BullMQ connection).
// BullMQ requires its own connection — QueueService creates a separate ioredis instance
// from the same REDIS_URL so BullMQ can manage its own lifecycle.
export const redis = new Redis(process.env.REDIS_URL!, {
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  logger.error({ err, component: "redis" }, "Redis connection error");
});
