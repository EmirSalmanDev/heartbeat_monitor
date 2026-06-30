export interface PingResult {
  result: "UP" | "DOWN";
  statusCode: number | null;
  latencyMs: number | null;
  errorMsg: string | null;
  checkedAt: Date;
}

const PING_TIMEOUT_MS = 10_000;
const SUCCESS_STATUS_RANGE = { min: 200, max: 399 }; // 2xx ve 3xx == UP

export async function ping(url: string): Promise<PingResult> {
  // HEAD response body indirmez -> hızlı
  const checkedAt = new Date();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "manual", // never follow redirects — redirect targets are not validated
      credentials: "omit",
    });

    const latencyMs = Date.now() - startMs;
    const statusCode = response.status;
    // In Node.js fetch (undici), redirect: "manual" returns the actual redirect
    // status code (e.g. 301) rather than an opaque status 0. The redirect is
    // never followed, so the Location URL is never fetched — SSRF is prevented.
    const isUp =
      statusCode >= SUCCESS_STATUS_RANGE.min &&
      statusCode <= SUCCESS_STATUS_RANGE.max;

    return {
      result: isUp ? "UP" : "DOWN",
      statusCode,
      latencyMs,
      errorMsg: isUp ? null : `HTTP ${statusCode} ${response.statusText}`.trim(),
      checkedAt,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startMs;
    let errorMsg = "Unknown error";
    if (err instanceof Error) {
      errorMsg =
        err.name === "AbortError"
          ? `Timeout after ${PING_TIMEOUT_MS}ms`
          : err.message.slice(0, 200);
    }
    return { result: "DOWN", statusCode: null, latencyMs, errorMsg, checkedAt };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function pingWithFallback(url: string): Promise<PingResult> {
  const headResult = await ping(url);
  if (headResult.statusCode === 405) {
    // method not allowed dönerse get ile dene
    return pingWithGet(url);
  }
  return headResult;
}

async function pingWithGet(url: string): Promise<PingResult> {
  const checkedAt = new Date();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual", // never follow redirects — redirect targets are not validated
      credentials: "omit",
    });

    // Discard the body immediately — status code is all we need.
    response.body?.cancel().catch(() => {});

    const latencyMs = Date.now() - startMs;
    const statusCode = response.status;
    const isUp =
      statusCode >= SUCCESS_STATUS_RANGE.min &&
      statusCode <= SUCCESS_STATUS_RANGE.max;

    return {
      result: isUp ? "UP" : "DOWN",
      statusCode,
      latencyMs,
      errorMsg: isUp ? null : `HTTP ${statusCode} ${response.statusText}`.trim(),
      checkedAt,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startMs;
    let errorMsg = "Unknown error";
    if (err instanceof Error) {
      errorMsg =
        err.name === "AbortError"
          ? `Timeout after ${PING_TIMEOUT_MS}ms`
          : err.message.slice(0, 200);
    }
    return { result: "DOWN", statusCode: null, latencyMs, errorMsg, checkedAt };
  } finally {
    clearTimeout(timeoutId);
  }
}
