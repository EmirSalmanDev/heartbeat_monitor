import { Worker } from "bullmq";
import IORedis from "ioredis";
import { retentionService } from "../container.js";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const retentionWorker = new Worker(
  "retention-queue",
  async () => {
    await retentionService.deleteOldChecks();
  },
  { connection },
);

retentionWorker.on("failed", (job, err) => {
  console.error(`[Retention] Job ${job?.id} failed:`, err.message);
});

retentionWorker.on("error", (err) => {
  console.error("[Retention] Worker error:", err.message);
});
