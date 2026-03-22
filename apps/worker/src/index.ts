import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { MetricsService } from "./services/MetricsService.js";
import { PingService } from "./services/PingService.js";

const metricsService = new MetricsService();

export const pingService = new PingService(prisma, redis, metricsService);

// pingProcessor imports `pingService` from this file. Static imports are hoisted
// to the top of the module before any code runs, so a static import here would
// execute pingProcessor before `pingService` is initialised — causing a circular
// dependency and an undefined reference. Dynamic import runs after the export is
// in place, guaranteeing pingProcessor receives the fully constructed instance.
await import("./processors/pingProcessor.js");

console.log("Worker started — listening for ping jobs...");
