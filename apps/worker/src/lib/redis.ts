import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!, {
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err.message);
});
