import "dotenv/config";
import { createServer } from "http";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { metricsService } from "./container.js";

const { worker } = await import("./processors/pingProcessor.js").catch(
  (err) => {
    console.error("Failed to start ping processor:", err);
    process.exit(1);
  },
);

const { retentionWorker } = await import(
  "./processors/retentionProcessor.js"
).catch((err) => {
  console.error("Failed to start retention processor:", err);
  process.exit(1);
});

console.log("Worker started — listening for ping and retention jobs...");

// Minimal HTTP server — serves Prometheus metrics and a health check.
// Runs on a separate internal port so Nginx can proxy /metrics here
// without exposing it through the API container.
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9091);

const metricsServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/metrics") {
    metricsService
      .getMetrics()
      .then((body) => {
        res.writeHead(200, { "Content-Type": metricsService.getContentType() });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500);
        res.end("Internal Server Error");
      });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

metricsServer.listen(METRICS_PORT, () => {
  console.log(`[Worker] Metrics server listening on port ${METRICS_PORT}`);
});

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  console.log(`[Worker] ${signal} received — shutting down gracefully`);

  await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
  console.log("[Worker] Metrics server closed");

  try {
    await worker.close();
    console.log("[Worker] Ping worker closed");
  } catch (err) {
    console.error("[Worker] Error closing ping worker:", (err as Error).message);
  }

  try {
    await retentionWorker.close();
    console.log("[Worker] Retention worker closed");
  } catch (err) {
    console.error(
      "[Worker] Error closing retention worker:",
      (err as Error).message,
    );
  }
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
