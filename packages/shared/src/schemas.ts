import { z } from "zod";

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
  url: z.string().url("Must be a valid URL"),
  intervalSecs: z
    .number()
    .int()
    .min(30, "Minimum interval is 30 seconds")
    .max(3600, "Maximum interval is 1 hour")
    .default(60),
});

export const UpdateMonitorSchema = CreateMonitorSchema.partial()
  .extend({
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
