import { register, Counter, Histogram, Gauge } from "prom-client";

/**
 * Single label value every request that matched no route collapses into.
 *
 * requestLogger's routePattern() falls back to req.originalUrl, which is correct
 * for logs but would be a cardinality bug here: any 404 probe or bot scanning
 * random paths would mint its raw path as a new label value and a new time
 * series. Metrics use matchedRoute() + this constant instead.
 */
export const UNMATCHED_ROUTE = "unmatched";

// Same guard as apps/worker/src/services/MetricsService.ts: prom-client throws
// if a metric name is registered twice, which happens on tsx watch hot reload.
// Kept duplicated rather than hoisted into @sentinel/shared — it is three lines,
// and sharing it would mean rewriting the worker's working MetricsService for no
// behavioural gain.
export class MetricsService {
  private requestCounter: Counter;
  private durationHistogram: Histogram;
  private inFlightGauge: Gauge;

  constructor() {
    this.requestCounter =
      (register.getSingleMetric(
        "sentinel_http_requests_total",
      ) as Counter<string>) ??
      new Counter({
        name: "sentinel_http_requests_total",
        help: "Total HTTP requests handled by the API",
        // Route *pattern* only — never req.path/req.originalUrl, which carry
        // the interpolated monitor ID and would be one series per resource.
        labelNames: ["method", "route", "status_code"],
      });

    this.durationHistogram =
      (register.getSingleMetric(
        "sentinel_http_request_duration_seconds",
      ) as Histogram<string>) ??
      new Histogram({
        name: "sentinel_http_request_duration_seconds",
        help: "HTTP request duration distribution",
        labelNames: ["method", "route", "status_code"],
        // The worker's ping histogram starts at 0.05s because it measures
        // network round-trips; a local REST handler needs a tighter low end.
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      });

    this.inFlightGauge =
      (register.getSingleMetric(
        "sentinel_http_requests_in_flight",
      ) as Gauge<string>) ??
      new Gauge({
        name: "sentinel_http_requests_in_flight",
        help: "HTTP requests currently being handled",
        // Unlabelled: a single always-bounded series.
        labelNames: [],
      });
  }

  requestStarted(): void {
    this.inFlightGauge.inc();
  }

  requestFinished(): void {
    this.inFlightGauge.dec();
  }

  /**
   * `route` must already be a route pattern or UNMATCHED_ROUTE — this method
   * does not sanitise it. See createMetricsMiddleware.
   */
  recordRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSecs: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.requestCounter.labels(labels).inc();
    this.durationHistogram.observe(labels, durationSecs);
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }
}
