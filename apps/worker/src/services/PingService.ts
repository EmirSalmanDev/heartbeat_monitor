import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import { pingWithFallback } from "@sentinel/shared";
import { MetricsService } from "./MetricsService.js";

export class PingService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private metrics: MetricsService,
  ) {}

  async execute(monitorId: string, url: string): Promise<void> {
    const result = await pingWithFallback(url);

    await this.prisma.check.create({
      data: {
        monitorId,
        result: result.result,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg ?? null,
        checkedAt: result.checkedAt,
      },
    });

    await this.redis.setex(
      `current_status:${monitorId}`,
      90,
      JSON.stringify(result),
    );

    this.metrics.recordPing(result.result, monitorId, result.latencyMs);
  }
}
