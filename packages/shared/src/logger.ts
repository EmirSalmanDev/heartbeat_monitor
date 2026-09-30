import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

/** Which app a log line came from. Emitted as the `service` field on every line. */
export type ServiceName = "api" | "worker";

// Anything matching these paths is censored before it reaches stdout. Handled by
// pino's built-in redact option rather than by hand so it also covers objects
// that are logged wholesale (req.headers, req.body) without every call site
// remembering to strip them.
const REDACT_PATHS = [
  "password",
  "token",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "*.password",
  "*.token",
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*.Cookie",
  "req.body.password",
  "req.body.token",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "body.password",
  "body.token",
];

/**
 * Builds the one pino instance an app should use. Both apps share this factory —
 * the only thing that differs between them is the `service` binding, so there is
 * no reason for api and worker to configure pino separately.
 *
 * Every line is JSON carrying at minimum: level, msg, time, service.
 * Level is emitted as a label ("info") rather than pino's default numeric value
 * so log lines stay readable and filterable as-is.
 */
export function createLogger(
  service: ServiceName,
  options: LoggerOptions = {},
): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: pino.stdSerializers.err, // keeps the full stack trace on `err`
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...options,
  });
}
