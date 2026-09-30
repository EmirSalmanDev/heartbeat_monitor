import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "@sentinel/shared";

export class QueueService {
  private queue: Queue;

  constructor(
    redisUrl: string,
    private logger: Logger,
  ) {
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

  /**
   * `log` is the request-scoped logger (req.log, with requestId bound) when the
   * call originates from an HTTP request, so the scheduling line is traceable to
   * the request that caused it. Falls back to the constructor-injected app
   * logger for callers with no request context — same pattern as
   * PingService.execute()'s parentLog.
   */
  async scheduleMonitor(
    monitorId: string,
    url: string,
    intervalSecs: number,
    log?: Logger,
  ) {
    await this.queue.add(
      "ping",
      { monitorId, url },
      {
        jobId: `monitor-${monitorId}`,
        repeat: { every: intervalSecs * 1000 },
      },
    );

    (log ?? this.logger).info(
      { monitorId, intervalSecs, jobId: `monitor-${monitorId}` },
      "Monitor ping job scheduled",
    );
  }

  /** `log`: see scheduleMonitor above. */
  async removeMonitor(monitorId: string, intervalSecs: number, log?: Logger) {
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

    (log ?? this.logger).info(
      { monitorId, intervalSecs, jobId: `monitor-${monitorId}` },
      "Monitor ping job unscheduled",
    );
  }
}
