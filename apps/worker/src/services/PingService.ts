import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import { pingWithFallback, type CurrentStatus } from "@sentinel/shared";
import { AnomalyDetectionService } from "./AnomalyDetectionService.js";
import { MetricsService } from "./MetricsService.js";

export class PingService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private metrics: MetricsService,
    private anomalyDetection: AnomalyDetectionService,
  ) {}

  async execute(monitorId: string, url: string): Promise<void> {
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

    this.metrics.recordPing(result.result, monitorId, result.latencyMs);

    // Anomaly detection is observational — it must never fail the ping job.
    // Letting it throw would mark the BullMQ job failed and, on retry, write a
    // duplicate Check row for a ping that already succeeded.
    try {
      await this.anomalyDetection.evaluate(
        monitorId,
        result.latencyMs,
        result.result,
      );
    } catch (err) {
      console.error(
        `[AnomalyDetection] evaluate failed for monitor ${monitorId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
