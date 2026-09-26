import "dotenv/config";
import { createServer } from "node:http";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { metricsService } from "./container.js";

const { worker } = await import("./processors/pingProcessor.js").catch(
  (err) => {
    logger.fatal({ err }, "Failed to start ping processor");
    process.exit(1);
  },
);

logger.info({ queue: "monitor-queue" }, "Worker started — listening for ping jobs");

// Expose Prometheus metrics on a dedicated port so nginx can scrape it
// without routing through the API. Port 9091 is reachable within sentinel_net.
const METRICS_PORT = 9091;
const metricsServer = createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": metricsService.getContentType() });
    res.end(await metricsService.getMetrics());
  } else {
    res.writeHead(404);
    res.end();
  }
});
metricsServer.listen(METRICS_PORT, () => {
  logger.info({ port: METRICS_PORT }, "Metrics server listening");
});

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down gracefully");
  metricsServer.close();
  try {
    await worker.close();
    logger.info("BullMQ worker closed");
  } catch (err) {
    logger.error({ err }, "Error closing BullMQ worker");
  }
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
