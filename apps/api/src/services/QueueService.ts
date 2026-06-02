import { Queue } from "bullmq";
import Redis from "ioredis";

export class QueueService {
  private queue: Queue;
  private retentionQueue: Queue;

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

    this.retentionQueue = new Queue("retention-queue", { connection });
  }

  async scheduleMonitor(monitorId: string, url: string, intervalSecs: number) {
    await this.queue.add(
      "ping",
      { monitorId, url },
      {
        repeat: { every: intervalSecs * 1000, jobId: `monitor-${monitorId}` },
      },
    );
  }

  async removeMonitor(monitorId: string, intervalSecs: number) {
    await this.queue.removeRepeatable("ping", { every: intervalSecs * 1000 });
    await this.queue.remove(`monitor-${monitorId}`);
  }

  async scheduleRetention() {
    await this.retentionQueue.add(
      "retention",
      {},
      {
        jobId: "retention-job",
        repeat: { every: 86400 * 1000 },
      },
    );
  }
}
