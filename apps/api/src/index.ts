import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { QueueService } from "./services/QueueService.js";
import { MonitorService } from "./services/MonitorService.js";
import { AuthService } from "./services/AuthService.js";
import { createAuthRouter } from "./routes/auth.js";
import { createMonitorRouter } from "./routes/monitor.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// middleware
app.use(express.json());
app.use(cookieParser()); // Required to read req.cookies.token

// DI
const queueService = new QueueService(process.env.REDIS_URL!);
const authService = new AuthService(prisma);
const monitorService = new MonitorService(prisma, redis, queueService);

// routes
app.use("/auth", createAuthRouter(authService));
app.use("/monitors", createMonitorRouter(monitorService, authService));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(errorHandler); // global

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(
    `[API] Listening on port ${PORT} — ${process.env.NODE_ENV ?? "development"}`,
  );
  void queueService.scheduleRetention();
});

// shutdown
process.on("SIGTERM", async () => {
  console.log("[API] SIGTERM received — shutting down gracefully");
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});
