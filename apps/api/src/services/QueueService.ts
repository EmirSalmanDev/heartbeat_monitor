import { Queue } from "bullmq";
import Redis from "ioredis";

//  QueueService — BullMQ producer.
//  Note: BullMQ requires its own ioredis connection (separate from the cache client)
//  because it sets maxRetriesPerRequest: null and manages blocking commands internally.
export class QueueService {
  private queue: Queue;

  constructor(redisUrl: string) {
    // Create a dedicated Redis connection for BullMQ — do NOT share with cache redis
    const connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue("monitor-queue", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }

  async scheduleMonitor(monitorId: string, url: string, intervalSecs: number) {
    await this.queue.add(
      "ping",
      { monitorId, url },
      {
        repeat: { every: intervalSecs * 1000 },
        jobId: `monitor-${monitorId}`, // Stable jobId prevents duplicate schedules on restart
      },
    );
  }

  async removeMonitor(monitorId: string) {
    // Remove the repeating job definition — in-flight jobs are not affected
    const repeatableJobs = await this.queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) =>
      j.key.includes(`monitor-${monitorId}`),
    );
    if (job) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
