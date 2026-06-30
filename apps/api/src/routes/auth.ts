import { Router } from "express";
import { AuthService } from "../services/AuthService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createAuthMiddleware } from "../middleware/authMiddleware.js";
import { LoginSchema, RegisterSchema, ok } from "@sentinel/shared";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export function createAuthRouter(authService: AuthService) {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const { email, password } = RegisterSchema.parse(req.body);
      const user = await authService.register(email, password);
      const token = authService.issueToken(user.id);
      res.cookie("token", token, COOKIE_OPTIONS);
      res.status(201).json(ok({ message: "User created", user }));
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { email, password } = LoginSchema.parse(req.body);
      const token = await authService.login(email, password);
      res.cookie("token", token, COOKIE_OPTIONS);
      res.json(ok({ message: "Login successful" }));
    }),
  );

  router.post("/logout", (_req, res) => {
    res.clearCookie("token", COOKIE_OPTIONS);
    res.json(ok({ message: "Logged out" }));
  });

  router.get(
    "/me",
    auth,
    asyncHandler(async (req, res) => {
      res.json(ok({ userId: req.userId }));
    }),
  );

  return router;
}
