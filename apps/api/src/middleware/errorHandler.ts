import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError, type Logger } from "@sentinel/shared";
import { routePattern } from "./requestLogger.js";

/**
 * Factory so the logger is injected rather than imported globally, matching
 * createAuthMiddleware / createAuthRouter. The passed logger is only a fallback:
 * normally the request-scoped req.log (requestId already bound) is used.
 */
export function createErrorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // req.log already binds requestId; only the fallback needs it added, so it
    // is never emitted twice in the same line.
    const log = req.log ?? logger.child({ requestId: req.requestId });
    const context = {
      method: req.method,
      route: routePattern(req),
      path: req.originalUrl,
    };

    if (err instanceof AppError) {
      // Expected/handled — warn, no stack trace. Previously silent, which made
      // every 4xx (auth failures included) invisible in logs.
      log.warn(
        {
          ...context,
          statusCode: err.statusCode,
          code: err.code,
          errorMessage: err.message,
        },
        "Request rejected",
      );
      return res.status(err.statusCode).json({
        success: false,
        error: { message: err.message, code: err.code },
      });
    }

    if (err instanceof ZodError) {
      log.warn(
        {
          ...context,
          statusCode: 400,
          code: "VALIDATION_ERROR",
          errorMessage: "Validation failed",
          issues: err.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
          })),
        },
        "Request failed validation",
      );
      return res.status(400).json({
        success: false,
        error: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: err.flatten(),
        },
      });
    }

    log.error(
      {
        ...context,
        statusCode: 500,
        // stdSerializers.err (set in createLogger) keeps the full stack trace.
        err: err instanceof Error ? err : new Error(String(err)),
      },
      "Unhandled error",
    );
    return res.status(500).json({
      success: false,
      error: { message: "Internal server error", code: "INTERNAL_ERROR" },
    });
  };
}
