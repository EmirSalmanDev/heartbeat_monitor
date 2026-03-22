import Redis from "ioredis";

// Single ioredis instance shared by MonitorService (cache) and QueueService (BullMQ connection).
// BullMQ requires its own connection — QueueService creates a separate ioredis instance
// from the same REDIS_URL so BullMQ can manage its own lifecycle.
export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // Required by BullMQ when sharing a client
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err.message);
});
