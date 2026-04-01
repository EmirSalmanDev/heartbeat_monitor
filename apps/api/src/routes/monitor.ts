import { Router } from "express";
import { MonitorService } from "../services/MonitorService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createAuthMiddleware } from "../middleware/authMiddleware.js";
import { AuthService } from "../services/AuthService.js";
import { CreateMonitorSchema, ok } from "@sentinel/shared";

export function createMonitorRouter(
  monitorService: MonitorService,
  authService: AuthService,
) {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.use(auth);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const monitors = await monitorService.findAllByUser(req.userId);
      res.json(ok(monitors));
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const data = CreateMonitorSchema.parse(req.body);
      const monitor = await monitorService.create(data, req.userId);
      res.status(201).json(ok(monitor));
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const monitor = await monitorService.findById(req.params.id, req.userId);
      res.json(ok(monitor));
    }),
  );

  router.get(
    "/:id/status",
    asyncHandler(async (req, res) => {
      const status = await monitorService.getStatus(req.params.id, req.userId);
      res.json(ok(status));
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await monitorService.delete(req.params.id, req.userId);
      res.status(204).send(); // 204 — body yok, ok() sarma
    }),
  );

  return router;
}
