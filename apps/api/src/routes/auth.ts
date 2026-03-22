import { Router } from "express";
import { AuthService } from "../services/AuthService";
import { asyncHandler } from "../middleware/asyncHandler";
import { createAuthMiddleware } from "../middleware/authMiddleware";
import { LoginSchema, RegisterSchema } from "@sentinel/shared";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

export function createAuthRouter(authService: AuthService) {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const { email, password } = RegisterSchema.parse(req.body);
      const { passwordHash: _, ...userDto } = await authService.register(
        email,
        password,
      );
      res.status(201).json({ message: "User created", user: userDto });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { email, password } = LoginSchema.parse(req.body);
      const token = await authService.login(email, password);
      res.cookie("token", token, COOKIE_OPTIONS);
      res.json({ message: "Login successful" });
    }),
  );

  router.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
  });

  // Lightweight "am I logged in?" endpoint for the React app
  router.get(
    "/me",
    auth,
    asyncHandler(async (req, res) => {
      res.json({ userId: req.userId });
    }),
  );

  return router;
}
