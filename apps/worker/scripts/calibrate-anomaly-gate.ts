/**
 * Statistical calibration check for the latency-spike gate.
 *
 * Unlike verify:anomaly, this one talks to a REAL Redis, because its whole
 * purpose is to measure the behaviour of the actual Lua script rather than the
 * JS mirror in the verification script. It is intentionally NOT part of CI: it
 * needs a Redis instance and takes appreciably longer than a unit check.
 *
 *   docker run --rm -p 6379:6379 redis:7-alpine
 *   REDIS_URL=redis://localhost:6379 pnpm --filter @sentinel/worker calibrate:anomaly
 *
 * What it measures: feed the gate stationary Gaussian latency — a monitor that
 * is behaving perfectly, just with normal variance — and count how often it
 * calls that an anomaly. A correctly calibrated two-sided 3-sigma gate should
 * fire on 0.270% of samples. Materially above that and the detector is crying
 * wolf; materially below and it will miss real degradations.
 */

import { Redis } from "ioredis";
import {
  ANOMALY_TUNING,
  ROLLING_STATS_LUA,
} from "../src/services/AnomalyDetectionService.js";

const TARGET_PCT = 0.27;
// Generous band: this is a stochastic measurement, and the estimator's own
// noise puts the true value a little above the ideal-normal 0.270%.
const TOLERANCE_PCT = 0.12;

function makeGauss(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = uniform() * 2 - 1;
      v = uniform() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

/**
 * Runs `n` samples through the real Lua script and returns the percentage that
 * fired. `needStreak` is passed explicitly so we can measure the raw per-sample
 * band-crossing rate (1) as well as the debounced event rate (the configured
 * SPIKE_CONSECUTIVE).
 */
async function measure(
  redis: Redis,
  key: string,
  n: number,
  mean: number,
  sigma: number,
  seed: number,
  needStreak: number,
): Promise<number> {
  const t = ANOMALY_TUNING;
  const gauss = makeGauss(seed);
  await redis.del(key);

  let fired = 0;
  let scored = 0;

  // Pipeline in batches — a round-trip per sample would make this take hours.
  const BATCH = 5_000;
  for (let done = 0; done < n; done += BATCH) {
    const size = Math.min(BATCH, n - done);
    const pipe = redis.pipeline();
    for (let i = 0; i < size; i++) {
      pipe.eval(
        ROLLING_STATS_LUA,
        1,
        key,
        mean + sigma * gauss(),
        t.ALPHA_MEAN,
        t.ALPHA_VAR,
        t.SPIKE_K,
        t.MIN_SAMPLES,
        t.MIN_SD_MS,
        t.DEVIATION_SCALE,
        needStreak,
        t.STATS_TTL_SECONDS,
      );
    }
    const results = await pipe.exec();
    if (!results) throw new Error("pipeline returned no results");
    for (const [err, value] of results) {
      if (err) throw err;
      const [firedRaw] = value as [string, string];
      // Warmup samples report "0" with no baseline; they are counted as scored
      // only after MIN_SAMPLES, which the script enforces internally. Counting
      // them all slightly understates the rate, so skip the warmup batch.
      scored++;
      if (firedRaw === "1") fired++;
    }
  }

  await redis.del(key);
  return (fired / scored) * 100;
}

async function main(): Promise<void> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(url, { maxRetriesPerRequest: 3 });

  console.log(`Anomaly gate calibration  (redis: ${url})`);
  console.log(
    `tuning: alphaMean=${ANOMALY_TUNING.ALPHA_MEAN} alphaVar=${ANOMALY_TUNING.ALPHA_VAR} ` +
      `k=${ANOMALY_TUNING.SPIKE_K} scale=${ANOMALY_TUNING.DEVIATION_SCALE.toFixed(4)} ` +
      `consecutive=${ANOMALY_TUNING.SPIKE_CONSECUTIVE}`,
  );
  console.log(
    `\nStationary Gaussian latency — a healthy monitor. Target ${TARGET_PCT}% of samples.\n`,
  );

  const N = 200_000;
  let failures = 0;

  // Across several latency scales, to confirm the gate is scale-free and is not
  // quietly relying on the MIN_SD_MS floor.
  const cases: Array<[number, number]> = [
    [100, 10],
    [250, 25],
    [800, 80],
    [2000, 200],
  ];

  for (const [mean, sigma] of cases) {
    const pct = await measure(
      redis,
      `calibrate:${mean}:${sigma}`,
      N,
      mean,
      sigma,
      1234 + mean,
      1,
    );
    const ok = Math.abs(pct - TARGET_PCT) <= TOLERANCE_PCT;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} mean=${String(mean).padStart(4)}ms sigma=${String(sigma).padStart(3)}ms  ` +
        `band-crossing rate ${pct.toFixed(3)}%  (target ${TARGET_PCT}% ±${TOLERANCE_PCT})`,
    );
  }

  // And the debounced rate actually in force, which is far rarer by design.
  const debounced = await measure(
    redis,
    "calibrate:debounced",
    N,
    250,
    25,
    99,
    ANOMALY_TUNING.SPIKE_CONSECUTIVE,
  );
  const perPings = debounced > 0 ? Math.round(100 / debounced) : Infinity;
  console.log(
    `\n  with SPIKE_CONSECUTIVE=${ANOMALY_TUNING.SPIKE_CONSECUTIVE}: ${debounced.toFixed(4)}% ` +
      `(~1 false event per ${perPings === Infinity ? ">" + N.toLocaleString() : perPings.toLocaleString()} pings)`,
  );

  await redis.quit();
  console.log(
    failures === 0
      ? "\nGate is correctly calibrated."
      : `\n${failures} case(s) OUT OF CALIBRATION.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
