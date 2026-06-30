import "dotenv/config";
import { createServer } from "node:http";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { metricsService } from "./container.js";

const { worker } = await import("./processors/pingProcessor.js").catch(
  (err) => {
    console.error("Failed to start ping processor:", err);
    process.exit(1);
  },
);

console.log("Worker started — listening for ping jobs...");

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
  console.log(`[Worker] Metrics server listening on port ${METRICS_PORT}`);
});

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  console.log(`[Worker] ${signal} received — shutting down gracefully`);
  metricsServer.close();
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
