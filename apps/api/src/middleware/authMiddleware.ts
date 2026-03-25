import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/AuthService.js";
import { UnauthorizedError } from "@sentinel/shared";

// Extend Express Request so downstream handlers get req.userId with full type-safety
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createAuthMiddleware(authService: AuthService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.token as string | undefined;

    if (!token) {
      return next(new UnauthorizedError());
    }

    try {
      const payload = authService.verifyToken(token);
      req.userId = payload.userId;
      next();
    } catch {
      next(new UnauthorizedError());
    }
  };
}
