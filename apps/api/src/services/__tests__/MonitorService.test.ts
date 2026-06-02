import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";
import { MonitorService } from "../MonitorService.js";
import { QueueService } from "../QueueService.js";
import { ForbiddenError, NotFoundError } from "@sentinel/shared";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://sentinel:changeme@localhost:5432/sentinel_test";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const queueStub = {
  scheduleMonitor: vi.fn().mockResolvedValue(undefined),
  removeMonitor: vi.fn().mockResolvedValue(undefined),
  scheduleRetention: vi.fn().mockResolvedValue(undefined),
} as unknown as QueueService;

const redisStub = {
  get: vi.fn().mockResolvedValue(null),
  mget: vi.fn().mockResolvedValue([]),
  setex: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
} as unknown as Redis;

const monitorService = new MonitorService(prisma, redisStub, queueStub);

beforeEach(async () => {
  await prisma.check.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.monitor.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(email = "user@example.com") {
  return prisma.user.create({
    data: { email, passwordHash: "hash" },
  });
}

describe("MonitorService", () => {
  describe("create()", () => {
    it("creates a monitor and returns MonitorDto with currentStatus null", async () => {
      const user = await createUser();
      const dto = await monitorService.create(
        { name: "My Monitor", url: "https://example.com", intervalSecs: 60 },
        user.id,
      );
      expect(dto.id).toBeDefined();
      expect(dto.name).toBe("My Monitor");
      expect(dto.url).toBe("https://example.com");
      expect(dto.intervalSecs).toBe(60);
      expect(dto.currentStatus).toBeNull();
      expect(typeof dto.createdAt).toBe("string");
      expect(queueStub.scheduleMonitor).toHaveBeenCalledOnce();
    });
  });

  describe("findAllByUser()", () => {
    it("returns only monitors owned by the given userId", async () => {
      const userA = await createUser("a@example.com");
      const userB = await createUser("b@example.com");

      await monitorService.create(
        { name: "A1", url: "https://a1.com", intervalSecs: 30 },
        userA.id,
      );
      await monitorService.create(
        { name: "A2", url: "https://a2.com", intervalSecs: 60 },
        userA.id,
      );
      await monitorService.create(
        { name: "B1", url: "https://b1.com", intervalSecs: 60 },
        userB.id,
      );

      const results = await monitorService.findAllByUser(userA.id);
      expect(results).toHaveLength(2);
      expect(results.every((m) => m.userId === userA.id)).toBe(true);
    });
  });

  describe("findById()", () => {
    it("throws ForbiddenError when userId does not match owner", async () => {
      const owner = await createUser("owner@example.com");
      const other = await createUser("other@example.com");

      const dto = await monitorService.create(
        { name: "Secret", url: "https://secret.com", intervalSecs: 60 },
        owner.id,
      );

      await expect(
        monitorService.findById(dto.id, other.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("delete()", () => {
    it("removes the monitor; subsequent findById throws NotFoundError", async () => {
      const user = await createUser();
      const dto = await monitorService.create(
        { name: "Temp", url: "https://temp.com", intervalSecs: 60 },
        user.id,
      );

      await monitorService.delete(dto.id, user.id);

      await expect(
        monitorService.findById(dto.id, user.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
