import { Request, Response, NextFunction } from "express";
import {
  MetricsService,
  UNMATCHED_ROUTE,
} from "../services/MetricsService.js";
import { matchedRoute } from "./requestLogger.js";

/**
 * Registered early so the in-flight gauge covers the whole request, but the
 * duration/counter observation happens on 'finish' — by then routing has
 * resolved, so req.route is populated and matchedRoute() can return the pattern
 * (`/monitors/:id`) rather than the interpolated path.
 *
 * Requests that matched no route are recorded as UNMATCHED_ROUTE, never as their
 * raw path.
 */
export function createMetricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startNs = process.hrtime.bigint();
    metrics.requestStarted();

    // 'finish' fires on a completed response, 'close' on a client that hung up
    // mid-flight. Either one settles the request; guard so the gauge is only
    // decremented once when both fire.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;

      metrics.requestFinished();
      metrics.recordRequest(
        req.method,
        matchedRoute(req) ?? UNMATCHED_ROUTE,
        res.statusCode,
        Number(process.hrtime.bigint() - startNs) / 1e9,
      );
    };

    res.on("finish", settle);
    res.on("close", settle);

    next();
  };
}
