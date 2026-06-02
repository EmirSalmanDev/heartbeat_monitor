import { PrismaClient, AlertType } from "@sentinel/db";
import { Redis } from "ioredis";
import { pingWithFallback, type CurrentStatus } from "@sentinel/shared";
import { MetricsService } from "./MetricsService.js";

export class PingService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private metrics: MetricsService,
  ) {}

  async execute(monitorId: string, url: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { status: true },
    });
    if (!monitor || monitor.status === "PAUSED") return;

    const prevRaw = await this.redis.get(`current_status:${monitorId}`);
    const prev: { result: string } | null = prevRaw ? JSON.parse(prevRaw) : null;

    const result = await pingWithFallback(url);

    // Persist result and use the returned Check record as the source of truth
    // for caching. Redis stores a JSON-serialized representation of this Check
    // record, which MonitorService.getStatus() can read from the cache.
    const check = await this.prisma.check.create({
      data: {
        monitorId,
        result: result.result,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg ?? null,
        checkedAt: result.checkedAt,
      },
    });

    // Normalize to CurrentStatus DTO before caching.
    // JSON.stringify(check) would serialize checkedAt to an ISO string in the
    // cached JSON, while a fresh Prisma Check record has checkedAt as a Date.
    // Using CurrentStatus ensures checkedAt is consistently an ISO string,
    // regardless of whether the data comes from the database or the cache.
    const currentStatus: CurrentStatus = {
      result: check.result,
      statusCode: check.statusCode,
      latencyMs: check.latencyMs,
      checkedAt: check.checkedAt.toISOString(),
    };

    await this.redis.setex(
      `current_status:${monitorId}`,
      90,
      JSON.stringify(currentStatus),
    );

    if (prev !== null) {
      let alertType: AlertType | null = null;
      if (prev.result === "UP" && check.result === "DOWN") alertType = AlertType.DOWN;
      else if (prev.result === "DOWN" && check.result === "UP") alertType = AlertType.RECOVERED;

      if (alertType !== null) {
        this.prisma.alert
          .create({ data: { monitorId, type: alertType } })
          .catch((err) => console.error("[PingService] alert write failed:", err));
      }
    }

    this.metrics.recordPing(result.result, monitorId, result.latencyMs);
  }
}
