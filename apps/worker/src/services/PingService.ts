import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import {
  pingWithFallback,
  type CurrentStatus,
  type Logger,
} from "@sentinel/shared";
import { MetricsService } from "./MetricsService.js";

export class PingService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private metrics: MetricsService,
    private logger: Logger,
  ) {}

  /**
   * `parentLog` is the execution-scoped child built by pingProcessor (carries
   * executionId + jobId), so every line below is traceable to a single run.
   * Falls back to the app logger when called outside a job.
   */
  async execute(
    monitorId: string,
    url: string,
    parentLog?: Logger,
  ): Promise<void> {
    // pingProcessor's child already binds monitorId (alongside executionId and
    // jobId); re-binding it here would emit the key twice in the same JSON line.
    const log = parentLog ?? this.logger.child({ monitorId });

    log.debug({ url }, "Ping attempt started");
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

    const outcome = {
      url,
      checkId: check.id,
      result: result.result,
      statusCode: result.statusCode ?? null,
      latencyMs: result.latencyMs,
    };

    // A DOWN result is an individual failed ping attempt, not a crash — warn.
    if (result.result === "UP") {
      log.info(outcome, "Ping succeeded");
    } else {
      log.warn({ ...outcome, errorMsg: result.errorMsg ?? null }, "Ping failed");
    }

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
  }
}
