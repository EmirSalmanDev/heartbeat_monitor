import { PrismaClient } from "@sentinel/db";

export class RetentionService {
  constructor(private prisma: PrismaClient) {}

  async deleteOldChecks(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.check.deleteMany({
      where: { checkedAt: { lt: thirtyDaysAgo } },
    });
    console.log(`[Retention] Deleted ${count} check records older than 30 days`);
  }
}
