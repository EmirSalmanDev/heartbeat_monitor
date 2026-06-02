import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import {
  NotFoundError,
  ForbiddenError,
  type CurrentStatus,
  type MonitorDto,
  type CheckDto,
  type UpdateMonitorInput,
} from "@sentinel/shared";
import { QueueService } from "./QueueService.js";

type CheckStat = {
  result: string;
  _count: { result: number };
  _avg: { latencyMs: number | null };
};

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

  private computeStats(rows: CheckStat[]): {
    uptime24h: number | null;
    avgLatency24h: number | null;
  } {
    if (rows.length === 0) return { uptime24h: null, avgLatency24h: null };

    const upRow = rows.find((r) => r.result === "UP");
    const downRow = rows.find((r) => r.result === "DOWN");
    const upCount = upRow?._count.result ?? 0;
    const downCount = downRow?._count.result ?? 0;
    const total = upCount + downCount;

    if (total === 0) return { uptime24h: null, avgLatency24h: null };

    const uptime24h = Math.round((upCount / total) * 1000) / 10;
    const avgLatency24h =
      upRow?._avg.latencyMs != null
        ? Math.round(upRow._avg.latencyMs * 10) / 10
        : null;

    return { uptime24h, avgLatency24h };
  }

  private async calculateStats(monitorId: string): Promise<{
    uptime24h: number | null;
    avgLatency24h: number | null;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.check.groupBy({
      by: ["result"],
      where: { monitorId, checkedAt: { gte: since } },
      _count: { result: true },
      _avg: { latencyMs: true },
    });
    return this.computeStats(rows);
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

    if (monitors.length === 0) return [];

    const monitorIds = monitors.map((m) => m.id);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Single round-trip to Redis + single aggregate DB query in parallel
    const [cachedValues, statsRows] = await Promise.all([
      this.redis.mget(monitorIds.map((id) => `current_status:${id}`)),
      this.prisma.check.groupBy({
        by: ["monitorId", "result"],
        where: { monitorId: { in: monitorIds }, checkedAt: { gte: since } },
        _count: { result: true },
        _avg: { latencyMs: true },
      }),
    ]);

    const statusMap = new Map<string, string | null>(
      monitorIds.map((id, i) => [id as string, cachedValues[i]])
    );

    // Index rows by monitorId for O(1) lookup during map
    const statsByMonitor = new Map<string, CheckStat[]>();
    for (const row of statsRows) {
      const arr = statsByMonitor.get(row.monitorId) ?? [];
      arr.push(row);
      statsByMonitor.set(row.monitorId, arr);
    }

    return monitors.map((m) => {
      const { uptime24h, avgLatency24h } = this.computeStats(
        statsByMonitor.get(m.id) ?? [],
      );
      return {
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        currentStatus: this.parseStatus(statusMap.get(m.id) ?? null),
        uptime24h,
        avgLatency24h,
      } satisfies MonitorDto;
    });
  }

  async findById(id: string, userId: string): Promise<MonitorDto> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id } });
    if (!monitor) throw new NotFoundError("Monitor");
    if (monitor.userId !== userId) throw new ForbiddenError();

    const [cached, { uptime24h, avgLatency24h }] = await Promise.all([
      this.redis.get(`current_status:${id}`),
      this.calculateStats(id),
    ]);

    return {
      ...monitor,
      createdAt: monitor.createdAt.toISOString(),
      updatedAt: monitor.updatedAt.toISOString(),
      currentStatus: this.parseStatus(cached),
      uptime24h,
      avgLatency24h,
    } satisfies MonitorDto;
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

    const [cached, { uptime24h, avgLatency24h }] = await Promise.all([
      this.redis.get(`current_status:${id}`),
      this.calculateStats(id),
    ]);

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      currentStatus: this.parseStatus(cached),
      uptime24h,
      avgLatency24h,
    } satisfies MonitorDto;
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

  async getChecks(
    monitorId: string,
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ checks: CheckDto[]; total: number }> {
    await this.verifyOwnership(monitorId, userId);

    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.check.findMany({
        where: { monitorId },
        orderBy: { checkedAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.check.count({ where: { monitorId } }),
    ]);

    const checks: CheckDto[] = rows.map((c) => ({
      id: c.id,
      monitorId: c.monitorId,
      result: c.result,
      statusCode: c.statusCode,
      latencyMs: c.latencyMs,
      errorMsg: c.errorMsg,
      checkedAt: c.checkedAt.toISOString(),
    }));

    return { checks, total };
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
