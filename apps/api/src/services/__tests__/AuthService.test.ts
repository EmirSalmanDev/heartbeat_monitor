import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@sentinel/db";
import { AuthService } from "../AuthService.js";
import { ValidationError, UnauthorizedError } from "@sentinel/shared";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://sentinel:changeme@localhost:5432/sentinel_test";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const authService = new AuthService(prisma);

process.env.JWT_SECRET = "test-secret";

beforeEach(async () => {
  await prisma.check.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.monitor.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AuthService", () => {
  describe("register()", () => {
    it("creates a user and returns UserDto without passwordHash", async () => {
      const dto = await authService.register("test@example.com", "password123");
      expect(dto.id).toBeDefined();
      expect(dto.email).toBe("test@example.com");
      expect(dto.createdAt).toBeDefined();
      expect((dto as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it("throws ValidationError when email already exists", async () => {
      await authService.register("dup@example.com", "password123");
      await expect(
        authService.register("dup@example.com", "other")
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("login()", () => {
    it("returns a JWT string for valid credentials", async () => {
      await authService.register("login@example.com", "correctpass");
      const token = await authService.login("login@example.com", "correctpass");
      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3);
    });

    it("throws UnauthorizedError for wrong password", async () => {
      await authService.register("wrong@example.com", "correctpass");
      await expect(
        authService.login("wrong@example.com", "wrongpass")
      ).rejects.toThrow(UnauthorizedError);
    });

    it("throws UnauthorizedError for unknown email", async () => {
      await expect(
        authService.login("nobody@example.com", "anypass")
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("verifyToken()", () => {
    it("returns { userId } for a valid token", async () => {
      await authService.register("verify@example.com", "password123");
      const token = await authService.login("verify@example.com", "password123");
      const payload = authService.verifyToken(token);
      expect(payload.userId).toBeDefined();
      expect(typeof payload.userId).toBe("string");
    });

    it("throws for an invalid token", () => {
      expect(() => authService.verifyToken("not.a.token")).toThrow();
    });
  });
});
