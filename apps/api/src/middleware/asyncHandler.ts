import { Request, Response, NextFunction, RequestHandler } from "express";
import { captureRoutePattern } from "./requestLogger.js";

// no try-catch needed in every async route handler
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    // Routing has resolved by now and req.baseUrl still holds the router's mount
    // path, so this is the last point where the full pattern is recoverable — an
    // error thrown below unwinds baseUrl before metrics/logs read it on 'finish'.
    captureRoutePattern(req);
    fn(req, res, next).catch(next);
  };
}
