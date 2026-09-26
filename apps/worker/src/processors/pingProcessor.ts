import { randomUUID } from "node:crypto";
import { Worker, Job } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { pingService } from "../container.js";
import { logger } from "../lib/logger.js";

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

// Correlation: these are *repeatable* jobs, enqueued once when the monitor is
// created and re-fired on a schedule forever, so job.id (`monitor-<id>`) is fixed
// for the monitor's whole lifetime — it identifies which monitor, not which run.
// A fresh executionId per invocation is what ties one run's log lines together.
// If a manual "trigger this monitor now" endpoint is ever added, that path *would*
// have an originating HTTP request worth correlating: pass the API's requestId
// through the job payload there and bind it alongside executionId below. Nothing
// here needs to change to make that possible.
export const worker = new Worker<PingJobData>(
  "monitor-queue",
  async (job: Job<PingJobData>) => {
    const executionId = randomUUID();
    const log = logger.child({
      executionId,
      jobId: job.id,
      monitorId: job.data.monitorId,
      attempt: job.attemptsMade + 1,
    });

    log.debug({ url: job.data.url }, "Ping job started");
    await pingService.execute(job.data.monitorId, job.data.url, log);
  },
  {
    connection,
    concurrency: 10,
  },
);

worker.on("failed", (job, err) => {
  const attemptsMade = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 1;
  const log = logger.child({
    jobId: job?.id,
    monitorId: job?.data?.monitorId,
    attemptsMade,
    maxAttempts,
  });

  if (attemptsMade >= maxAttempts) {
    log.error({ err }, "Ping job failed — retries exhausted");
  } else {
    log.warn({ err }, "Ping job attempt failed — will retry");
  }
});

worker.on("error", (err) => {
  logger.error({ err }, "BullMQ worker error");
});
