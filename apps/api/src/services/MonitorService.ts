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

  // --- HELPERS ---

  private parseStatus(cached: string | null | undefined): CurrentStatus | null {
    if (!cached) return null;
    try {
      return JSON.parse(cached) as CurrentStatus;
    } catch {
      return null;
    }
  }

  private async verifyOwnership(id: string, userId: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!monitor) throw new NotFoundError("Monitor");
    if (monitor.userId !== userId) throw new ForbiddenError();
  }

  // --- PUBLIC METHODS ---

  async create(
    data: { name: string; url: string; intervalSecs: number },
    userId: string,
  ): Promise<MonitorDto> {
    const monitor = await this.prisma.monitor.create({
      data: { ...data, userId },
    });

    await this.queue.scheduleMonitor(
      monitor.id,
      monitor.url,
      monitor.intervalSecs,
    );

    return {
      ...monitor,
      createdAt: monitor.createdAt.toISOString(),
      updatedAt: monitor.updatedAt.toISOString(),
      currentStatus: null,
    } satisfies MonitorDto;
  }

  async findAllByUser(userId: string): Promise<MonitorDto[]> {
    const monitors = await this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    // Early exit
    if (monitors.length === 0) return [];

    const keys = monitors.map((m) => `current_status:${m.id}`);
    const cachedStatuses = await this.redis.mget(keys);

    return monitors.map((m, index) => {
      return {
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        currentStatus: this.parseStatus(cachedStatuses[index]),
      } satisfies MonitorDto;
    });
  }

  async findById(id: string, userId: string): Promise<MonitorDto> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id } });
    if (!monitor) throw new NotFoundError("Monitor");
    if (monitor.userId !== userId) throw new ForbiddenError();

    const cached = await this.redis.get(`current_status:${id}`);

    return {
      ...monitor,
      createdAt: monitor.createdAt.toISOString(),
      updatedAt: monitor.updatedAt.toISOString(),
      currentStatus: this.parseStatus(cached), // Helper
    };
  }

  async update(
    id: string,
    userId: string,
    data: UpdateMonitorInput,
  ): Promise<MonitorDto> {
    // Ownership check yerine tam monitor çek — eski intervalSecs lazım
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Monitor");
    if (existing.userId !== userId) throw new ForbiddenError();

    const updated = await this.prisma.monitor.update({ where: { id }, data });

    const shouldReschedule =
      data.intervalSecs !== undefined ||
      data.status !== undefined ||
      data.url !== undefined;

    if (shouldReschedule) {
      // Eski intervalSecs ile kaldır — yeni değerle değil
      await this.queue.removeMonitor(id, existing.intervalSecs);
      if (updated.status !== "PAUSED") {
        await this.queue.scheduleMonitor(id, updated.url, updated.intervalSecs);
      }
    }

    const cached = await this.redis.get(`current_status:${id}`);

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      currentStatus: this.parseStatus(cached),
    };
  }

  async getStatus(
    monitorId: string,
    userId: string,
  ): Promise<CurrentStatus | null> {
    await this.verifyOwnership(monitorId, userId);

    const cached = await this.redis.get(`current_status:${monitorId}`);
    const parsedStatus = this.parseStatus(cached);
    if (parsedStatus) return parsedStatus;

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
    const existing = await this.prisma.monitor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Monitor");
    if (existing.userId !== userId) throw new ForbiddenError();

    await this.queue.removeMonitor(id, existing.intervalSecs);
    await this.prisma.monitor.delete({ where: { id } });
    await this.redis.del(`current_status:${id}`);
  }
}
