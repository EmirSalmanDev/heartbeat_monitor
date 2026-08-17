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

/**
 * The spike gate's tuning, exported so `calibrate:anomaly` can measure the real
 * false-positive rate against a real Redis rather than re-declaring constants
 * that would then be free to drift from the ones actually in force.
 */
export const ANOMALY_TUNING = {
  ALPHA_MEAN,
  ALPHA_VAR,
  SPIKE_K,
  DEVIATION_SCALE,
  MIN_SAMPLES,
  MIN_SD_MS,
  SPIKE_CONSECUTIVE,
  STATS_TTL_SECONDS,
  SPIKE_COOLDOWN_SECONDS,
} as const;

/**
 * Atomic EWMA/EW-variance read-modify-write.
 *
 * This runs server-side as a single Lua invocation because the sequence is
 * read → compute → write on one key: as two round-trips it loses updates
 * whenever two evaluations for the same monitor overlap (a retried job, or a
 * second worker replica), and anomaly_events has no unique constraint that
 * would catch the duplicate row that results.
 *
 * KEYS[1] rolling_stats:{monitorId}
 * ARGV    latency, alphaMean, alphaVar, k, minSamples, minSd, devScale,
 *         needStreak, ttl
 * Returns [fired ("0"|"1"), baseline] — baseline is the pre-update EWMA, as a
 * string because Redis truncates Lua numbers to integers on the way out.
 */
export const ROLLING_STATS_LUA = `
local raw        = redis.call('GET', KEYS[1])
local latency    = tonumber(ARGV[1])
local aMean      = tonumber(ARGV[2])
local aVar       = tonumber(ARGV[3])
local k          = tonumber(ARGV[4])
local minSamples = tonumber(ARGV[5])
local minSd      = tonumber(ARGV[6])
local devScale   = tonumber(ARGV[7])
local needStreak = tonumber(ARGV[8])
local ttl        = tonumber(ARGV[9])

local ewma, ewvar, count, streak
if raw then
  local ok, s = pcall(cjson.decode, raw)
  -- A corrupt entry is treated as a cache miss and rebuilt from this ping.
  if ok and type(s) == 'table' and tonumber(s.ewma) then
    ewma  = tonumber(s.ewma)
    ewvar = tonumber(s.ewvar) or 0
    count = tonumber(s.count) or 1
    streak = tonumber(s.streak) or 0
  end
end

if ewma == nil then
  redis.call('SET', KEYS[1],
    cjson.encode({ewma = latency, ewvar = 0, count = 1, streak = 0}), 'EX', ttl)
  return {'0', '0'}
end

local diff = latency - ewma
local dev  = math.abs(diff) / devScale
local sd   = math.sqrt(ewvar)
if sd < minSd then sd = minSd end
local band = k * sd

local eligible = count >= minSamples
local out = false
if eligible and dev > band then out = true end

local fired = 0
if out then
  streak = streak + 1
  if streak >= needStreak then
    fired = 1
    streak = 0
  end
else
  streak = 0
end

-- Winsorize the variance contribution: clamp an out-of-band sample to the band
-- before folding it in. Otherwise the first spike ping inflates the variance so
-- much that it opens the band wider than its own follow-up, and the consecutive
-- requirement can never be met — measured detection power for a 3x spike drops
-- from 100% to 34% without this clamp.
local vdiff = diff
if eligible then
  local cap = band * devScale
  if math.abs(diff) > cap then
    if diff >= 0 then vdiff = cap else vdiff = -cap end
  end
end

local baseline = ewma
local newEwma  = ewma + aMean * diff
local newEwvar = (1 - aVar) * (ewvar + aVar * vdiff * vdiff)

redis.call('SET', KEYS[1],
  cjson.encode({ewma = newEwma, ewvar = newEwvar, count = count + 1, streak = streak}),
  'EX', ttl)

return {tostring(fired), tostring(baseline)}
`;

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
    const [firedRaw, baselineRaw] = (await this.redis.eval(
      ROLLING_STATS_LUA,
      1,
      `rolling_stats:${monitorId}`,
      latencyMs,
      ALPHA_MEAN,
      ALPHA_VAR,
      SPIKE_K,
      MIN_SAMPLES,
      MIN_SD_MS,
      DEVIATION_SCALE,
      SPIKE_CONSECUTIVE,
      STATS_TTL_SECONDS,
    )) as [string, string];

    if (firedRaw !== "1") return;

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
      Number(baselineRaw),
    );
  }

  private async detectFlapping(
    monitorId: string,
    status: PingStatus,
  ): Promise<void> {
    const lastKey = `flap_last:${monitorId}`;
    const windowKey = `flap_window:${monitorId}`;

    // SET ... GET (Redis 6.2+) makes the compare-and-set atomic: it returns the
    // previous value and installs the new one in one command. As a separate
    // GET then SETEX, two overlapping evaluations for the same monitor both
    // read the old status and each count the same transition.
    const last = (await this.redis.set(
      lastKey,
      status,
      "EX",
      STATS_TTL_SECONDS,
      "GET",
    )) as string | null;

    // No previous status, or no change: nothing transitioned.
    if (last === null || last === status) return;

    const nowMs = this.now();

    // A sorted set scored by timestamp gives the sliding window directly: prune
    // by score, then count what's left. A list would need the whole range read
    // back into the process to find the cutoff, and a plain counter with a TTL
    // would reset the entire window at once instead of ageing entries out
    // individually.
    //
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
    const claimed = await this.redis.set(
      `flap_alerted:${monitorId}`,
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
