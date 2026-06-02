import { Worker, Job } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { pingService } from "../container.js";

interface PingJobData {
  monitorId: string;
  url: string;
}

// BullMQ requires its own dedicated Redis connection with maxRetriesPerRequest: null.
// Using the shared cache redis instance would cause BullMQ to interfere with
// cache-aside reads/writes and break job processing on connection interruptions.
const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const worker = new Worker<PingJobData>(
  "monitor-queue",
  async (job: Job<PingJobData>) => {
    await pingService.execute(job.data.monitorId, job.data.url);
  },
  {
    connection,
    concurrency: 10,
  },
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err.message);
});
