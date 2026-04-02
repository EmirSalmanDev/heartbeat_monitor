import { Queue } from "bullmq";
import Redis from "ioredis";

export class QueueService {
  private queue: Queue;

  constructor(redisUrl: string) {
    // BullMQ için ayrı Redis bağlantısı — cache client ile paylaşılmaz
    const connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue("monitor-queue", {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "fixed", delay: 1000 },
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
        repeat: {
          every: intervalSecs * 1000,
          jobId: monitorId, // removeRepeatable için şart
        },
      },
    );
  }

  // O(1)
  async removeMonitor(monitorId: string, intervalSecs: number) {
    await this.queue.removeRepeatable("ping", {
      every: intervalSecs * 1000,
      jobId: monitorId,
    });
  }
}
