import "dotenv/config";
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
const { worker } = await import("./processors/pingProcessor.js").catch(
  (err) => {
    console.error("Failed to start ping processor:", err);
    process.exit(1);
  },
);

console.log("Worker started — listening for ping jobs...");

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  console.log(`[Worker] ${signal} received — shutting down gracefully`);
  try {
    await worker.close();
    console.log("[Worker] BullMQ worker closed");
  } catch (err) {
    console.error(
      "[Worker] Error closing BullMQ worker:",
      (err as Error).message,
    );
  }
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
