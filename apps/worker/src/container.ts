// container.ts initialises all services (PingService, MetricsService).
// pingProcessor.ts imports pingService from container.ts — not from index.ts —
// so there is no circular dependency.

import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { MetricsService } from "./services/MetricsService.js";
import { PingService } from "./services/PingService.js";

const metricsService = new MetricsService();

export const pingService = new PingService(prisma, redis, metricsService);
