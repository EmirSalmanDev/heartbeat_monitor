import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import "./container.js";

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
