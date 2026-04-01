import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import {
  NotFoundError,
  ForbiddenError,
  type CurrentStatus,
  type MonitorDto,
  type UpdateMonitorInput,
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

    await this.queue.scheduleMonitor(
      monitor.id,
      monitor.url,
      monitor.intervalSecs,
    );

    return monitor;
  }

  // Her monitor için Redis'ten currentStatus çeker ve MonitorDto'ya ekler
  async findAllByUser(userId: string): Promise<MonitorDto[]> {
    const monitors = await this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    // Her monitor için Redis'ten currentStatus çek
    const enriched = await Promise.all(
      monitors.map(async (m) => {
        const cached = await this.redis.get(`current_status:${m.id}`);
        const currentStatus: CurrentStatus | null = cached
          ? (JSON.parse(cached) as CurrentStatus)
          : null;

        return {
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          currentStatus,
        } satisfies MonitorDto;
      }),
    );

    return enriched;
  }

  async findById(id: string, userId: string): Promise<MonitorDto> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id } });
    if (!monitor) throw new NotFoundError("Monitor");
    if (monitor.userId !== userId) throw new ForbiddenError();

    const cached = await this.redis.get(`current_status:${id}`);
    const currentStatus: CurrentStatus | null = cached
      ? (JSON.parse(cached) as CurrentStatus)
      : null;

    return {
      ...monitor,
      createdAt: monitor.createdAt.toISOString(),
      updatedAt: monitor.updatedAt.toISOString(),
      currentStatus,
    };
  }

  async update(
    id: string,
    userId: string,
    data: UpdateMonitorInput,
  ): Promise<MonitorDto> {
    // Ownership check
    await this.findById(id, userId);

    const updated = await this.prisma.monitor.update({
      where: { id },
      data,
    });

    // interval değiştiyse job'ı yeniden planla
    if (data.intervalSecs !== undefined || data.status !== undefined) {
      if (updated.status === "PAUSED") {
        await this.queue.removeMonitor(id);
      } else {
        // ACTIVE — yeniden planla (interval değişmiş olabilir)
        await this.queue.scheduleMonitor(id, updated.url, updated.intervalSecs);
      }
    }

    const cached = await this.redis.get(`current_status:${id}`);
    const currentStatus: CurrentStatus | null = cached
      ? (JSON.parse(cached) as CurrentStatus)
      : null;

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      currentStatus,
    };
  }

  async getStatus(
    monitorId: string,
    userId: string,
  ): Promise<CurrentStatus | null> {
    await this.findById(monitorId, userId);

    const cached = await this.redis.get(`current_status:${monitorId}`);
    if (cached) return JSON.parse(cached) as CurrentStatus;

    const latest = await this.prisma.check.findFirst({
      where: { monitorId },
      orderBy: { checkedAt: "desc" },
    });

    if (!latest) return null;

    const currentStatus: CurrentStatus = {
      result: latest.result,
      statusCode: latest.statusCode,
      latencyMs: latest.latencyMs,
      checkedAt: latest.checkedAt.toISOString(),
    };

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
