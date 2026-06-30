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
        jobId: `monitor-${monitorId}`,
        repeat: { every: intervalSecs * 1000 },
      },
    );
  }

  async removeMonitor(monitorId: string, intervalSecs: number) {
    // Pass jobId as the third argument so only this monitor's repeat job is
    // removed. Without it, removeRepeatable matches by name+interval and would
    // silently cancel every other monitor that shares the same intervalSecs.
    await this.queue.removeRepeatable(
      "ping",
      { every: intervalSecs * 1000 },
      `monitor-${monitorId}`,
    );
    // Also remove any pending one-time instance that may be queued.
    await this.queue.remove(`monitor-${monitorId}`);
  }
}
