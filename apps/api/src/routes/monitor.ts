import { Router, type RequestHandler } from "express";
import { MonitorService } from "../services/MonitorService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createAuthMiddleware } from "../middleware/authMiddleware.js";
import { AuthService } from "../services/AuthService.js";
import {
  CreateMonitorSchema,
  UpdateMonitorSchema,
  PaginationSchema,
  ok,
} from "@sentinel/shared";

export function createMonitorRouter(
  monitorService: MonitorService,
  authService: AuthService,
): Router {
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
    "/:id/checks",
    asyncHandler(async (req, res) => {
      const { page, limit } = PaginationSchema.parse(req.query);
      const { checks, total } = await monitorService.getChecks(
        req.params.id,
        req.userId,
        page,
        limit,
      );
      res.json(ok({ checks, total, page, limit }));
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const monitor = await monitorService.findById(req.params.id, req.userId);
      res.json(ok(monitor));
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const data = UpdateMonitorSchema.parse(req.body);
      const monitor = await monitorService.update(
        req.params.id,
        req.userId,
        data,
      );
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
      res.status(204).send();
    }),
  );

  return router;
}
