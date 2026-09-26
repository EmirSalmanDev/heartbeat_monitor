import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { QueueService } from "./services/QueueService.js";
import { MonitorService } from "./services/MonitorService.js";
import { AuthService } from "./services/AuthService.js";
import { MetricsService } from "./services/MetricsService.js";
import { createAuthRouter } from "./routes/auth.js";
import { createMonitorRouter } from "./routes/monitor.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import { createErrorHandler } from "./middleware/errorHandler.js";
import { createRequestLogger } from "./middleware/requestLogger.js";
import { createMetricsMiddleware } from "./middleware/metricsMiddleware.js";

// --- Startup assertions ---
const JWT_PLACEHOLDER = "buraya_en_az_32_karakterlik_rastgele_string_yaz";
const jwtSecret = process.env.JWT_SECRET ?? "";
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === JWT_PLACEHOLDER) {
  logger.fatal(
    "JWT_SECRET is missing, too short, or still set to the placeholder. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
  process.exit(1);
}

const app = express();

// Request ID + request-scoped logger. Registered first so every downstream
// middleware, route and the error handler can read req.requestId / req.log.
app.use(createRequestLogger(logger));

// Prometheus instrumentation. Early too, so the in-flight gauge covers the whole
// request; the duration/counter observation is deferred to res 'finish', once
// routing has resolved and the route pattern is known.
const metricsService = new MetricsService();
app.use(createMetricsMiddleware(metricsService));

// Security headers (inline; avoids adding the helmet dependency)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0"); // modern browsers ignore it; CSP is the real guard
  next();
});

app.use(express.json());
app.use(cookieParser()); // Required to read req.cookies.token

// DI
const queueService = new QueueService(process.env.REDIS_URL!, logger);
const authService = new AuthService(prisma);
const monitorService = new MonitorService(prisma, redis, queueService);

// routes
app.use("/auth", createAuthRouter(authService));
app.use("/monitors", createMonitorRouter(monitorService, authService));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Served on the main port — unlike the worker, which needs a dedicated 9091
// listener only because it has no Express app of its own.
app.get(
  "/metrics",
  asyncHandler(async (_req, res) => {
    res.setHeader("Content-Type", metricsService.getContentType());
    res.send(await metricsService.getMetrics());
  }),
);

app.use(createErrorHandler(logger)); // global

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  logger.info(
    { port: PORT, env: process.env.NODE_ENV ?? "development" },
    "API listening",
  );
});

// shutdown
process.on("SIGTERM", async () => {
  logger.info({ signal: "SIGTERM" }, "Shutting down gracefully");
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});
