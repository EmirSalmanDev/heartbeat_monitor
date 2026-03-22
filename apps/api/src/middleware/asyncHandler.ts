import { Request, Response, NextFunction, RequestHandler } from "express";

// no try-catch needed in every async route handler
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
