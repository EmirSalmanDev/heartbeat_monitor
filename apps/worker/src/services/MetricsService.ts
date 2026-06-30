import { register, Counter, Histogram } from "prom-client";

export class MetricsService {
  private pingCounter: Counter;
  private latencyHistogram: Histogram;

  constructor() {
    this.pingCounter =
      (register.getSingleMetric("sentinel_ping_total") as Counter<string>) ??
      new Counter({
        name: "sentinel_ping_total",
        help: "Total ping attempts",
        labelNames: ["status"],
      });

    this.latencyHistogram =
      (register.getSingleMetric("sentinel_ping_latency_seconds") as Histogram<string>) ??
      new Histogram({
        name: "sentinel_ping_latency_seconds",
        help: "Ping latency distribution",
        // monitorId removed — using it as a histogram label causes unbounded
        // cardinality (one time-series per monitor) which OOMs Prometheus.
        labelNames: [],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      });
  }

  recordPing(
    status: "UP" | "DOWN",
    _monitorId: string,
    latencyMs: number | null,
  ): void {
    this.pingCounter.labels({ status }).inc();
    if (latencyMs !== null) {
      this.latencyHistogram.observe(latencyMs / 1000);
    }
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }
}
