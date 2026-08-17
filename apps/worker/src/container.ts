// container.ts initialises all services (PingService, MetricsService,
// AnomalyDetectionService).
// pingProcessor.ts imports pingService from container.ts — not from index.ts —
// so there is no circular dependency.

import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { AnomalyDetectionService } from "./services/AnomalyDetectionService.js";
import { MetricsService } from "./services/MetricsService.js";
import { PingService } from "./services/PingService.js";

export const metricsService = new MetricsService();

// Shares the cache-aside redis client, not the dedicated BullMQ connection in
// pingProcessor.ts — see the note in that file for why those must stay separate.
export const anomalyDetectionService = new AnomalyDetectionService(
  prisma,
  redis,
);

export const pingService = new PingService(
  prisma,
  redis,
  metricsService,
  anomalyDetectionService,
);
