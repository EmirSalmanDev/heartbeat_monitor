import { PrismaClient } from "@sentinel/db";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});
