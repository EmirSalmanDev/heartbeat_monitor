import { Redis } from "ioredis";
import { logger } from "./logger.js";

export const redis = new Redis(process.env.REDIS_URL!, {
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  logger.error({ err, component: "redis" }, "Redis connection error");
});
