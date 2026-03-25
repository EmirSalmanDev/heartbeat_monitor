import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import {
  NotFoundError,
  ForbiddenError,
  type CurrentStatus,
} from "@sentinel/shared";
import { QueueService } from "./QueueService.js";

export class MonitorService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private queue: QueueService,
  ) {}

  async create(
    data: { name: string; url: string; intervalSecs: number },
    userId: string,
  ) {
    const monitor = await this.prisma.monitor.create({
      data: { ...data, userId },
    });

    // Schedule repeating BullMQ job — Worker will consume it
    await this.queue.scheduleMonitor(
      monitor.id,
      monitor.url,
      monitor.intervalSecs,
    );

    return monitor;
  }

  async findAllByUser(userId: string) {
    return this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string, userId: string) {
    const monitor = await this.prisma.monitor.findUnique({ where: { id } });
    if (!monitor) throw new NotFoundError("Monitor");
    if (monitor.userId !== userId) throw new ForbiddenError();
    return monitor;
  }

  /**
   * Redis cache-aside for current status.
   * PingService (Worker) writes this key after every ping with TTL 90s.
   * Cache miss falls back to last Heartbeat in Postgres and re-warms the cache.
   */
  async getStatus(
    monitorId: string,
    userId: string,
  ): Promise<CurrentStatus | null> {
    // Ownership check first
    await this.findById(monitorId, userId);

    const cached = await this.redis.get(`current_status:${monitorId}`);
    if (cached) return JSON.parse(cached) as CurrentStatus;

    const latest = await this.prisma.check.findFirst({
      where: { monitorId },
      orderBy: { checkedAt: "desc" },
    });

    if (!latest) return null;

    // Normalize to CurrentStatus DTO — keeps checkedAt as ISO string
    // consistent with the cache hit path
    const currentStatus: CurrentStatus = {
      result: latest.result,
      statusCode: latest.statusCode,
      latencyMs: latest.latencyMs,
      checkedAt: latest.checkedAt.toISOString(),
    };

    // Re-warm cache
    await this.redis.setex(
      `current_status:${monitorId}`,
      90,
      JSON.stringify(currentStatus),
    );
    return currentStatus;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findById(id, userId);

    await this.queue.removeMonitor(id);
    await this.prisma.monitor.delete({ where: { id } });
    await this.redis.del(`current_status:${id}`);
  }
}
