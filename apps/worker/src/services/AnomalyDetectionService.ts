import { AnomalyType, PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";

// EWMA smoothing factor. 0.3 weights recent pings meaningfully without letting
// a single sample dominate the baseline (~last 6 pings carry most of the weight).
const ALPHA = 0.3;

// Flag when |latest − EWMA| exceeds this many EW standard deviations.
const SPIKE_K = 3;

// Don't score against a baseline built from fewer than this many samples —
// early EWSD is meaningless and would flag ordinary jitter during warmup.
const MIN_SAMPLES = 5;

// Floor for the standard deviation, in ms. A monitor with near-constant latency
// converges to EWSD ≈ 0, which would make |latest − EWMA| > 3 × EWSD true for a
// 1ms wobble. The floor means "we never claim to know the latency to finer than
// 5ms", so only a real deviation clears the bar.
const MIN_SD_MS = 5;

// Rolling stats are a warm baseline, not a source of truth: same cache-aside
// contract as current_status (refreshed on every write, safe to lose — a miss
// just re-enters warmup). The horizon is long because a baseline has to survive
// gaps between pings on slow-interval monitors, where a 90s TTL would expire.
const STATS_TTL_SECONDS = 86_400;

// Sliding window for flap detection.
const FLAP_WINDOW_MS = 600_000; // 10 minutes
const FLAP_WINDOW_SECONDS = FLAP_WINDOW_MS / 1000;

// Flag when transitions within the window exceed this count (i.e. 4 or more).
const FLAP_THRESHOLD = 3;

type PingStatus = "UP" | "DOWN";

interface RollingStats {
  ewma: number;
  ewvar: number;
  count: number;
}

/**
 * Statistical anomaly detection over ping results.
 *
 * Detection and storage only: the sole effect of a detection is an AnomalyEvent
 * row. Nothing is sent anywhere and nothing downstream consumes these rows yet.
 *
 * Redis keys are namespaced separately from the `current_status:{monitorId}`
 * cache-aside entry that PingService writes, so the two never interact:
 *   rolling_stats:{monitorId}  — string, JSON EWMA/EW-variance state
 *   flap_window:{monitorId}    — sorted set, one member per status transition
 *   flap_last:{monitorId}      — string, last observed status
 *   flap_alerted:{monitorId}   — string, cooldown marker
 */
export class AnomalyDetectionService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    // Injected clock so the sliding window can be exercised deterministically
    // in tests without waiting ten real minutes.
    private now: () => number = () => Date.now(),
  ) {}

  async evaluate(
    monitorId: string,
    latencyMs: number | null,
    status: PingStatus,
  ): Promise<void> {
    // Explicit branch, not an implicit null-safe no-op. Latency-spike scoring is
    // skipped for DOWN pings on purpose: the pinger reports elapsed time even on
    // failure, so a DOWN result's latencyMs is a time-to-failure (up to the 10s
    // timeout), not a service response time. Feeding it into the baseline would
    // both fire a bogus spike and poison the EWMA for every later ping.
    if (status === "UP" && latencyMs !== null) {
      await this.detectLatencySpike(monitorId, latencyMs);
    }

    // Flapping is about up/down transitions, so it runs on every call regardless
    // of whether a latency value was available.
    await this.detectFlapping(monitorId, status);
  }

  private async detectLatencySpike(
    monitorId: string,
    latencyMs: number,
  ): Promise<void> {
    const key = `rolling_stats:${monitorId}`;
    const stats = await this.readStats(key);

    if (stats === null) {
      await this.writeStats(key, { ewma: latencyMs, ewvar: 0, count: 1 });
      return;
    }

    // Score the new sample against the baseline as it stands *before* this
    // sample is folded in — otherwise the spike partly explains itself.
    const deviation = Math.abs(latencyMs - stats.ewma);
    const ewsd = Math.max(Math.sqrt(stats.ewvar), MIN_SD_MS);
    const isSpike =
      stats.count >= MIN_SAMPLES && deviation > SPIKE_K * ewsd;

    // Update unconditionally, including on a spike. That is what keeps a
    // sustained shift from firing forever: the first ping at the new level is
    // the anomaly, after which the baseline adapts to it.
    const diff = latencyMs - stats.ewma;
    await this.writeStats(key, {
      ewma: stats.ewma + ALPHA * diff,
      ewvar: (1 - ALPHA) * (stats.ewvar + ALPHA * diff * diff),
      count: stats.count + 1,
    });

    if (isSpike) {
      await this.recordEvent(
        monitorId,
        AnomalyType.LATENCY_SPIKE,
        latencyMs,
        stats.ewma,
      );
    }
  }

  private async detectFlapping(
    monitorId: string,
    status: PingStatus,
  ): Promise<void> {
    const lastKey = `flap_last:${monitorId}`;
    const windowKey = `flap_window:${monitorId}`;

    const last = await this.redis.get(lastKey);
    await this.redis.setex(lastKey, STATS_TTL_SECONDS, status);

    // No previous status, or no change: nothing transitioned.
    if (last === null || last === status) return;

    const nowMs = this.now();

    // A sorted set scored by timestamp gives the sliding window directly: prune
    // by score, then count what's left. A list would need the whole range read
    // back into the process to find the cutoff, and a plain counter with a TTL
    // would reset the entire window at once instead of ageing entries out
    // individually.
    await this.redis
      .multi()
      .zadd(windowKey, nowMs, `${nowMs}:${status}`)
      .zremrangebyscore(windowKey, "-inf", nowMs - FLAP_WINDOW_MS)
      .expire(windowKey, FLAP_WINDOW_SECONDS)
      .exec();

    const transitions = await this.redis.zcard(windowKey);
    if (transitions <= FLAP_THRESHOLD) return;

    // Once a monitor is flapping it keeps transitioning, and every subsequent
    // transition would still be over threshold. Emit one event per window.
    const cooldownKey = `flap_alerted:${monitorId}`;
    const claimed = await this.redis.set(
      cooldownKey,
      "1",
      "EX",
      FLAP_WINDOW_SECONDS,
      "NX",
    );
    if (claimed === null) return;

    await this.recordEvent(
      monitorId,
      AnomalyType.FLAPPING,
      transitions,
      FLAP_THRESHOLD,
    );
  }

  private async readStats(key: string): Promise<RollingStats | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as RollingStats;
    } catch {
      // Corrupt entry — treat as a cache miss and rebuild from this ping.
      return null;
    }
  }

  private async writeStats(key: string, stats: RollingStats): Promise<void> {
    await this.redis.setex(key, STATS_TTL_SECONDS, JSON.stringify(stats));
  }

  private async recordEvent(
    monitorId: string,
    type: AnomalyType,
    value: number,
    baseline: number,
  ): Promise<void> {
    await this.prisma.anomalyEvent.create({
      data: { monitorId, type, value, baseline },
    });
  }
}
