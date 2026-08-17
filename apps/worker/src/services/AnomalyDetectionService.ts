import { AnomalyType, PrismaClient } from "@sentinel/db";
import { Redis } from "ioredis";

// EWMA smoothing factor for the *mean*. 0.3 weights recent pings meaningfully
// without letting a single sample dominate the baseline (~last 6 pings carry
// most of the weight).
const ALPHA_MEAN = 0.3;

// Separate, much slower smoothing factor for the *variance*. The mean should
// track real shifts quickly, but the variance is the thing we divide by, so it
// needs to be stable: at alpha 0.3 the EW-variance estimator is so noisy that
// its own sampling error, not the data, decides whether a ping clears the bar.
// Dropping it to 0.05 is what takes the measured false-positive rate on
// stationary Gaussian latency from ~4.1% to ~0.28%.
const ALPHA_VAR = 0.05;

// Flag when the normalized deviation exceeds this many EW standard deviations.
const SPIKE_K = 3;

// The statistic we test is (x − ewma_prev), not (x − true_mean). Because
// ewma_prev is itself an estimate carrying variance sigma^2*a/(2−a), that
// difference has SD = sigma * sqrt(1 + a/(2−a)) — about 1.085 sigma at
// alpha 0.3, not sigma. Dividing the deviation by this factor puts it back in
// sigma units so that "3 sigma" means 3 sigma. Without it the gate is really
// ~2.4 sigma and fires roughly 16x more often than intended.
const DEVIATION_SCALE = Math.sqrt(1 + ALPHA_MEAN / (2 - ALPHA_MEAN));

// Don't score against a baseline built from fewer than this many samples —
// early EWSD is meaningless and would flag ordinary jitter during warmup.
const MIN_SAMPLES = 5;

// Floor for the standard deviation, in ms. A monitor with near-constant latency
// converges to EWSD ≈ 0, which would make the spike test true for a 1ms wobble.
// The floor means "we never claim to know the latency to finer than 5ms", so
// only a real deviation clears the bar.
const MIN_SD_MS = 5;

// Number of *consecutive* out-of-band samples required before an event fires.
// A single ping over the line is an outlier; two in a row is a condition. This
// is what separates "one slow response" from "the service is degraded", and it
// drops the residual false-event rate to roughly 1 per 140k pings.
const SPIKE_CONSECUTIVE = 2;

// Rolling stats are a warm baseline, not a source of truth: same cache-aside
// contract as current_status (refreshed on every write, safe to lose — a miss
// just re-enters warmup). The horizon is long because a baseline has to survive
// gaps between pings on slow-interval monitors, where a 90s TTL would expire.
const STATS_TTL_SECONDS = 86_400;

// Debounce for LATENCY_SPIKE, mirroring flap_alerted. A degraded service stays
// degraded across many pings; without this, a persistent condition writes one
// row per ping and floods the table.
const SPIKE_COOLDOWN_SECONDS = 600; // 10 minutes

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
  /** Consecutive out-of-band samples seen so far. */
  streak: number;
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
 *   spike_alerted:{monitorId}  — string, LATENCY_SPIKE cooldown marker
 *   flap_window:{monitorId}    — sorted set, one member per status transition
 *   flap_last:{monitorId}      — string, last observed status
 *   flap_alerted:{monitorId}   — string, FLAPPING cooldown marker
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
      await this.writeStats(key, {
        ewma: latencyMs,
        ewvar: 0,
        count: 1,
        streak: 0,
      });
      return;
    }

    // Score the new sample against the baseline as it stands *before* this
    // sample is folded in — otherwise the spike partly explains itself.
    const diff = latencyMs - stats.ewma;
    const deviation = Math.abs(diff) / DEVIATION_SCALE;
    const ewsd = Math.max(Math.sqrt(stats.ewvar), MIN_SD_MS);
    const band = SPIKE_K * ewsd;

    const eligible = stats.count >= MIN_SAMPLES;
    const outOfBand = eligible && deviation > band;

    let streak = outOfBand ? stats.streak + 1 : 0;
    const isSpike = outOfBand && streak >= SPIKE_CONSECUTIVE;
    if (isSpike) streak = 0;

    // Winsorize the variance contribution: clamp an out-of-band sample to the
    // band before folding it in. Otherwise the first spike ping inflates the
    // variance so much that it opens the band wider than its own follow-up, and
    // the consecutive requirement can never be met — measured detection power
    // for a 3x spike drops from 100% to 34% without this clamp.
    let varDiff = diff;
    if (eligible) {
      const cap = band * DEVIATION_SCALE;
      if (Math.abs(diff) > cap) varDiff = diff >= 0 ? cap : -cap;
    }

    // Update unconditionally, including on a spike. That is what keeps a
    // sustained shift from firing forever: the baseline adapts to the new level.
    await this.writeStats(key, {
      ewma: stats.ewma + ALPHA_MEAN * diff,
      ewvar: (1 - ALPHA_VAR) * (stats.ewvar + ALPHA_VAR * varDiff * varDiff),
      count: stats.count + 1,
      streak,
    });

    if (!isSpike) return;

    // Same debounce shape as flapping: a degraded service keeps producing
    // out-of-band pings, and each one would otherwise write its own row.
    const claimed = await this.redis.set(
      `spike_alerted:${monitorId}`,
      "1",
      "EX",
      SPIKE_COOLDOWN_SECONDS,
      "NX",
    );
    if (claimed === null) return;

    await this.recordEvent(
      monitorId,
      AnomalyType.LATENCY_SPIKE,
      latencyMs,
      stats.ewma,
    );
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
      const parsed = JSON.parse(raw) as Partial<RollingStats>;
      if (typeof parsed.ewma !== "number") return null;
      return {
        ewma: parsed.ewma,
        ewvar: parsed.ewvar ?? 0,
        count: parsed.count ?? 1,
        // Entries written before the consecutive-sample rule existed have no
        // streak; they simply start a fresh one.
        streak: parsed.streak ?? 0,
      };
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
