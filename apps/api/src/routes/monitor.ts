import { Router } from "express";
import { z } from "zod";
import { MonitorService } from "../services/MonitorService";
import { asyncHandler } from "../middleware/asyncHandler";
import { createAuthMiddleware } from "../middleware/authMiddleware";
import { AuthService } from "../services/AuthService";

const CreateMonitorSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  intervalSeconds: z.number().int().min(30).max(86400).default(60),
});

export function createMonitorRouter(
  monitorService: MonitorService,
  authService: AuthService,
) {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  // All monitor routes require authentication
  router.use(auth);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const monitors = await monitorService.findAllByUser(req.userId);
      res.json(monitors);
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const data = CreateMonitorSchema.parse(req.body);
      const monitor = await monitorService.create(data, req.userId);
      res.status(201).json(monitor);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const monitor = await monitorService.findById(req.params.id, req.userId);
      res.json(monitor);
    }),
  );

  router.get(
    "/:id/status",
    asyncHandler(async (req, res) => {
      const status = await monitorService.getStatus(req.params.id, req.userId);
      res.json(status);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await monitorService.delete(req.params.id, req.userId);
      res.status(204).send();
    }),
  );

  return router;
}
