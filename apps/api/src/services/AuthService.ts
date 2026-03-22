import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UnauthorizedError, ValidationError } from "@sentinel/shared";

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async register(email: string, password: string) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ValidationError("Email already in use");

    const hashed = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email, passwordHash: hashed },
    });

    // Never return the password hash
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async login(email: string, password: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Constant-time comparison: always call bcrypt.compare even if user not found
    // to prevent timing-based user enumeration
    const dummyHash =
      "$2b$12$LqCimMbCJpR8KqJtH5VJFeTLpBBNkTJMjEOBL3qkRRdXlWC1a0Hry";
    const valid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!user || !valid) throw new UnauthorizedError();

    return jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
      expiresIn: "7d",
    });
  }

  verifyToken(token: string): { userId: string } {
    return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
  }
}
