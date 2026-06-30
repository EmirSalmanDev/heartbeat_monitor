import { z } from "zod";

// Blocked hostnames: loopback names, Docker service names on sentinel_net
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "redis",
  "postgres",
  "db",
  "api",
  "worker",
  "nginx",
]);

function isSafePublicUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (host === "0.0.0.0" || BLOCKED_HOSTNAMES.has(host)) return false;

  // IPv6 loopback / ULA / link-local (bracket notation: [::1], [fc00::], [fe80::])
  if (
    host === "[::1]" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd") ||
    host.startsWith("[fe80")
  )
    return false;

  // Literal IPv4 private ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
      return false;
  }

  return true;
}

const SAFE_URL_MESSAGE = "URL must point to a publicly reachable address";

export const RegisterSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateMonitorSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  url: z
    .string()
    .url("Must be a valid URL")
    .refine(isSafePublicUrl, { message: SAFE_URL_MESSAGE }),
  intervalSecs: z
    .number()
    .int()
    .min(30, "Minimum interval is 30 seconds")
    .max(3600, "Maximum interval is 1 hour")
    .default(60),
});

export const UpdateMonitorSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    url: z
      .string()
      .url()
      .refine(isSafePublicUrl, { message: SAFE_URL_MESSAGE })
      .optional(),
    intervalSecs: z.number().int().min(30).max(3600).optional(), // default yok
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided",
  });

export const MonitorIdSchema = z.object({
  id: z.string().cuid("Invalid monitor ID"),
});

export type CreateMonitorInput = z.infer<typeof CreateMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof UpdateMonitorSchema>;

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;
