import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import type { Logger } from "@sentinel/shared";

// Extend Express Request so downstream handlers and the error handler get the
// request ID and the request-scoped logger with full type-safety.
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      /** Snapshot taken by asyncHandler while the mount path is still valid. */
      routePattern?: string;
    }
  }
}

/**
 * Builds the route *pattern* including its router mount path (`/monitors/:id`)
 * from the request's current state, or null if no route has matched.
 *
 * Only correct while the matched layer is still on the stack. Once an error
 * unwinds out of a mounted router, Express restores req.baseUrl to the parent's
 * value ("") while req.route still points at the router's route, so this would
 * report "/" instead of "/monitors". Prefer matchedRoute(), which reads the
 * snapshot asyncHandler takes at handler-entry time.
 */
function computeRoutePattern(req: Request): string | null {
  const routePath = req.route?.path as string | undefined;
  if (!routePath) return null;
  const base = req.baseUrl ?? "";
  return routePath === "/" ? base || "/" : `${base}${routePath}`;
}

/**
 * The matched Express route *pattern*, or null when no route matched — a 404, or
 * an error thrown from middleware before routing resolved.
 *
 * Callers decide what "no match" means for them: routePattern() below falls back
 * to the raw URL, which is fine for a log line but must never be used for a
 * metric label. See MetricsService.UNMATCHED_ROUTE.
 */
export function matchedRoute(req: Request): string | null {
  return req.routePattern ?? computeRoutePattern(req);
}

/** Snapshot the pattern while req.baseUrl is still the router's mount path. */
export function captureRoutePattern(req: Request): void {
  req.routePattern ??= computeRoutePattern(req) ?? undefined;
}

/**
 * Prefers the matched route *pattern* (`/monitors/:id`) over the raw URL so log
 * lines group cleanly, falling back to the full URL when no route matched yet
 * (404s, or errors thrown from middleware before routing). Unbounded values are
 * not a problem on a log line.
 */
export function routePattern(req: Request): string {
  return matchedRoute(req) ?? req.originalUrl;
}

/**
 * Must be registered first in the middleware chain: everything downstream —
 * including errorHandler — reads req.requestId / req.log.
 *
 * Handlers log through req.log rather than the app logger so the request ID is
 * bound once here and never threaded through call sites by hand.
 */
export function createRequestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    req.log = logger.child({ requestId });
    res.setHeader("X-Request-Id", requestId);

    const startMs = Date.now();
    req.log.debug(
      { method: req.method, path: req.originalUrl },
      "Request received",
    );

    res.on("finish", () => {
      req.log.info(
        {
          method: req.method,
          route: routePattern(req),
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startMs,
        },
        "Request completed",
      );
    });

    next();
  };
}
