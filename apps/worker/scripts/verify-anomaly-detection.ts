/**
 * Behavioural verification for AnomalyDetectionService.
 *
 * This repo has no test runner wired up, so this is a standalone script rather
 * than a unit test file: run it with
 * `pnpm --filter @sentinel/worker verify:anomaly`. It adds no dependencies and
 * needs neither Postgres nor Redis — both are replaced with in-process fakes,
 * so it is safe to run anywhere, including CI.
 *
 * It lives outside src/ because tsconfig sets rootDir: ./src, so nothing here
 * is compiled into dist/ or shipped in the worker image.
 *
 * ── A caveat worth knowing ──────────────────────────────────────────────────
 * The rolling-stats update runs as a Lua script inside Redis in production.
 * FakeRedis cannot execute Lua, so `eval` below is a hand-written JS mirror of
 * that script. The mirror can drift from the real thing; it is here to exercise
 * the *service's* behaviour and its atomicity contract, not to prove the Lua
 * itself is correct. Changes to ROLLING_STATS_LUA must be mirrored by hand.
 */

import assert from "node:assert/strict";
import { AnomalyDetectionService } from "../src/services/AnomalyDetectionService.js";

// ─── Fakes ────────────────────────────────────────────────────────────────────

interface RecordedEvent {
  monitorId: string;
  type: string;
  value: number;
  baseline: number;
}

/** Captures only what the service is allowed to do: create AnomalyEvent rows. */
class FakePrisma {
  events: RecordedEvent[] = [];
  anomalyEvent = {
    create: async ({ data }: { data: RecordedEvent }) => {
      this.events.push({ ...data });
      return { id: `evt_${this.events.length}`, ...data, detectedAt: new Date() };
    },
  };
}

/** Yields to the event loop, so overlapping calls really do interleave. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Entry {
  value: string;
  /** Absolute expiry in ms on the injected clock; null means no TTL. */
  expiresAt: number | null;
}

/**
 * Minimal ioredis stand-in covering exactly the commands the service issues.
 *
 * Two things it models deliberately, because the service's correctness depends
 * on them and a simpler fake would hide bugs:
 *
 *  - TTLs actually expire, against the same injected clock the service uses.
 *    Without this, no cooldown is ever really tested — "fires exactly once"
 *    would hold by construction over a short simulated span.
 *  - Every command yields to the event loop before touching state, so two
 *    overlapping calls genuinely interleave. `eval` holds a lock across its
 *    whole body, which is what makes it a valid stand-in for Redis executing a
 *    Lua script atomically.
 */
class FakeRedis {
  strings = new Map<string, Entry>();
  zsets = new Map<string, { members: Map<string, number>; expiresAt: number | null }>();
  /** Every key the service has ever written, for the collision check. */
  touched = new Set<string>();
  /** Serializes eval, mirroring Redis's single-threaded script execution. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private now: () => number = () => Date.now()) {}

  private live(key: string): Entry | null {
    const e = this.strings.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.strings.delete(key);
      return null;
    }
    return e;
  }

  private liveZset(key: string) {
    const z = this.zsets.get(key);
    if (!z) return null;
    if (z.expiresAt !== null && this.now() >= z.expiresAt) {
      this.zsets.delete(key);
      return null;
    }
    return z;
  }

  private ttlAt(seconds: number): number {
    return this.now() + seconds * 1000;
  }

  async get(key: string): Promise<string | null> {
    await tick();
    return this.live(key)?.value ?? null;
  }

  async setex(key: string, ttl: number, value: string): Promise<"OK"> {
    await tick();
    this.touched.add(key);
    this.strings.set(key, { value, expiresAt: this.ttlAt(ttl) });
    return "OK";
  }

  /** Supports both `SET k v EX t NX` and `SET k v EX t GET`. */
  async set(
    key: string,
    value: string,
    _ex: "EX",
    ttl: number,
    mode: "NX" | "GET",
  ): Promise<"OK" | string | null> {
    await tick();
    const existing = this.live(key);
    if (mode === "NX") {
      if (existing) return null;
      this.touched.add(key);
      this.strings.set(key, { value, expiresAt: this.ttlAt(ttl) });
      return "OK";
    }
    // GET: return the previous value and install the new one, atomically.
    const previous = existing?.value ?? null;
    this.touched.add(key);
    this.strings.set(key, { value, expiresAt: this.ttlAt(ttl) });
    return previous;
  }

  async zcard(key: string): Promise<number> {
    await tick();
    return this.liveZset(key)?.members.size ?? 0;
  }

  private zaddSync(key: string, score: number, member: string): void {
    this.touched.add(key);
    const z = this.liveZset(key) ?? { members: new Map<string, number>(), expiresAt: null };
    z.members.set(member, score);
    this.zsets.set(key, z);
  }

  private zremrangebyscoreSync(key: string, min: string, max: number): void {
    const z = this.liveZset(key);
    if (!z) return;
    const lo = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    for (const [member, score] of z.members) {
      if (score >= lo && score <= max) z.members.delete(member);
    }
  }

  private expireSync(key: string, ttl: number): void {
    const z = this.liveZset(key);
    if (z) z.expiresAt = this.ttlAt(ttl);
    const s = this.live(key);
    if (s) s.expiresAt = this.ttlAt(ttl);
  }

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => this.zaddSync(key, score, member));
        return chain;
      },
      zremrangebyscore: (key: string, min: string, max: number) => {
        ops.push(() => this.zremrangebyscoreSync(key, min, max));
        return chain;
      },
      expire: (key: string, ttl: number) => {
        ops.push(() => this.expireSync(key, ttl));
        return chain;
      },
      exec: async () => {
        await tick();
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  }

  /**
   * JS mirror of ROLLING_STATS_LUA, executed under a lock so that — exactly
   * like a real Lua script — no other eval can interleave with it.
   */
  async eval(_script: string, _numKeys: number, ...args: unknown[]): Promise<[string, string]> {
    const run = async (): Promise<[string, string]> => {
      await tick();
      const key = String(args[0]);
      const [latency, aMean, aVar, k, minSamples, minSd, devScale, needStreak, ttl] =
        args.slice(1).map(Number);

      this.touched.add(key);
      const raw = this.live(key)?.value ?? null;

      let ewma: number | null = null;
      let ewvar = 0;
      let count = 1;
      let streak = 0;
      if (raw !== null) {
        try {
          const s = JSON.parse(raw);
          if (s && typeof s === "object" && Number.isFinite(Number(s.ewma))) {
            ewma = Number(s.ewma);
            ewvar = Number(s.ewvar) || 0;
            count = Number(s.count) || 1;
            streak = Number(s.streak) || 0;
          }
        } catch {
          // Corrupt entry — treated as a cache miss, same as the Lua pcall.
        }
      }

      const write = (v: Record<string, number>) => {
        this.strings.set(key, {
          value: JSON.stringify(v),
          expiresAt: this.ttlAt(ttl!),
        });
      };

      if (ewma === null) {
        write({ ewma: latency!, ewvar: 0, count: 1, streak: 0 });
        return ["0", "0"];
      }

      const diff = latency! - ewma;
      const dev = Math.abs(diff) / devScale!;
      const sd = Math.max(Math.sqrt(ewvar), minSd!);
      const band = k! * sd;

      const eligible = count >= minSamples!;
      const out = eligible && dev > band;

      let fired = 0;
      if (out) {
        streak += 1;
        if (streak >= needStreak!) {
          fired = 1;
          streak = 0;
        }
      } else {
        streak = 0;
      }

      let vdiff = diff;
      if (eligible) {
        const cap = band * devScale!;
        if (Math.abs(diff) > cap) vdiff = diff >= 0 ? cap : -cap;
      }

      const baseline = ewma;
      write({
        ewma: ewma + aMean! * diff,
        ewvar: (1 - aVar!) * (ewvar + aVar! * vdiff * vdiff),
        count: count + 1,
        streak,
      });
      return [String(fired), String(baseline)];
    };

    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────────

let failures = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : err}`);
  }
}

/** Builds a service with a controllable clock, starting at a fixed epoch. */
function build(startMs = 1_700_000_000_000) {
  const prisma = new FakePrisma();
  let clock = startMs;
  const redis = new FakeRedis(() => clock);
  const service = new AnomalyDetectionService(
    prisma as never,
    redis as never,
    () => clock,
  );
  return {
    prisma,
    redis,
    service,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const MONITOR_ID = "mon_test_1";

// ─── 1. Latency spike ─────────────────────────────────────────────────────────

async function latencySpikeTests(): Promise<void> {
  console.log("\nLatency spike");

  await test(
    "fires once, and only after the spike persists for two pings",
    async () => {
      const { prisma, service } = build();

      // Twelve normal pings with realistic small jitter around ~100ms.
      const normal = [100, 103, 98, 101, 99, 102, 97, 100, 104, 96, 101, 99];
      for (const [i, latency] of normal.entries()) {
        await service.evaluate(MONITOR_ID, latency, "UP");
        assert.equal(
          prisma.events.length,
          0,
          `event fired early, at normal ping #${i + 1} (${latency}ms)`,
        );
      }

      // First out-of-band ping: an outlier, not yet a condition.
      await service.evaluate(MONITOR_ID, 900, "UP");
      assert.equal(
        prisma.events.length,
        0,
        "a single out-of-band ping should not fire on its own",
      );

      // Second consecutive out-of-band ping: now it is a condition.
      await service.evaluate(MONITOR_ID, 900, "UP");

      assert.equal(prisma.events.length, 1, "expected exactly one event");
      const event = prisma.events[0]!;
      assert.equal(event.type, "LATENCY_SPIKE");
      assert.equal(event.monitorId, MONITOR_ID);
      assert.equal(event.value, 900, "value should be the observed latency");
      // The baseline has already absorbed 30% of the first spike ping, so it
      // sits between the old level and the new one rather than at ~100ms.
      assert.ok(
        event.baseline > 300 && event.baseline < 400,
        `baseline should be the EWMA before this ping (~340ms), got ${event.baseline}`,
      );
    },
  );

  await test("a large isolated outlier reports once, not once per ping", async () => {
    // Worth being precise about what the consecutive-sample rule does and does
    // not buy, because it is easy to assume it suppresses one-ping outliers.
    //
    // It does not. A 9x outlier drags the EWMA a long way (100 -> 340), and the
    // baseline then lags for several pings, so the *recovery* pings read as
    // out-of-band too. The streak re-arms and would fire every second ping all
    // the way back down. What the consecutive rule actually suppresses is
    // marginal noise crossings, where the EWMA barely moves and the next sample
    // lands back inside the band (see the jitter case below).
    //
    // The cooldown is what bounds the recovery tail to a single row — which is
    // exactly the flood this event type previously had no defence against.
    const { prisma, service } = build();
    for (let i = 0; i < 12; i++) await service.evaluate(MONITOR_ID, 100, "UP");

    await service.evaluate(MONITOR_ID, 900, "UP"); // the outlier
    for (let i = 0; i < 15; i++) await service.evaluate(MONITOR_ID, 100, "UP");

    assert.equal(
      prisma.events.length,
      1,
      `the outlier and its recovery tail are one event, got ${prisma.events.length}`,
    );
  });

  await test("does not fire during warmup, before MIN_SAMPLES", async () => {
    const { prisma, service } = build();
    // A spike on the 3rd ping: real deviation, but no trustworthy baseline yet.
    for (const latency of [100, 102, 900, 900]) {
      await service.evaluate(MONITOR_ID, latency, "UP");
    }
    assert.equal(prisma.events.length, 0, "should stay silent during warmup");
  });

  await test("ordinary jitter never fires", async () => {
    const { prisma, service } = build();
    for (let i = 0; i < 40; i++) {
      await service.evaluate(MONITOR_ID, 100 + (i % 5) - 2, "UP");
    }
    assert.equal(prisma.events.length, 0, "jitter should not be an anomaly");
  });

  await test("a sustained shift fires once, then adapts", async () => {
    const { prisma, service } = build();
    for (let i = 0; i < 12; i++) await service.evaluate(MONITOR_ID, 100, "UP");
    // Latency permanently moves to 900ms and stays there.
    for (let i = 0; i < 12; i++) await service.evaluate(MONITOR_ID, 900, "UP");
    assert.equal(
      prisma.events.length,
      1,
      "a step change is one anomaly, not one per ping",
    );
  });

}

// ─── 2. Flapping ──────────────────────────────────────────────────────────────

async function flappingTests(): Promise<void> {
  console.log("\nFlapping");

  await test("fires exactly once when >3 transitions occur in 10min", async () => {
    const { prisma, service, advance } = build();

    // Alternate every 60s: 8 pings inside the 10-minute window produce 7
    // transitions, crossing the threshold of 3 at the 4th.
    const statuses: Array<"UP" | "DOWN"> = [
      "UP", "DOWN", "UP", "DOWN", "UP", "DOWN", "UP", "DOWN",
    ];
    for (const status of statuses) {
      await service.evaluate(
        MONITOR_ID,
        status === "UP" ? 100 : null,
        status,
      );
      advance(60_000);
    }

    const flaps = prisma.events.filter((e) => e.type === "FLAPPING");
    assert.equal(flaps.length, 1, `expected 1 FLAPPING, got ${flaps.length}`);
    assert.equal(
      prisma.events.filter((e) => e.type === "LATENCY_SPIKE").length,
      0,
      "flapping run should not also report a latency spike",
    );
    assert.equal(flaps[0]!.value, 4, "value should be the transition count at flag time");
    assert.equal(flaps[0]!.baseline, 3, "baseline should be the threshold");
  });

  await test("stays silent at exactly the threshold (3 transitions)", async () => {
    const { prisma, service, advance } = build();
    for (const status of ["UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }
    assert.equal(prisma.events.length, 0, "3 transitions is not yet flapping");
  });

  await test("transitions ageing out of the window do not accumulate", async () => {
    const { prisma, service, advance } = build();
    // Four transitions, but spaced 5 minutes apart so at most two are ever
    // inside the same 10-minute window.
    for (const status of ["UP", "DOWN", "UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(300_000);
    }
    assert.equal(
      prisma.events.length,
      0,
      "slow up/down cycling over hours is not flapping",
    );
  });

  await test("a stable monitor records no transitions", async () => {
    const { prisma, redis, service, advance } = build();
    for (let i = 0; i < 20; i++) {
      await service.evaluate(MONITOR_ID, 100, "UP");
      advance(60_000);
    }
    assert.equal(prisma.events.length, 0);
    assert.equal(
      await redis.zcard(`flap_window:${MONITOR_ID}`),
      0,
      "no transitions should be recorded",
    );
  });

}

// ─── 3. DOWN ping with null latency ───────────────────────────────────────────

async function nullLatencyTests(): Promise<void> {
  console.log("\nDOWN ping with null latency");

  await test("does not throw", async () => {
    const { service } = build();
    await service.evaluate(MONITOR_ID, null, "DOWN");
  });

  await test("skips spike scoring — no rolling_stats key is written", async () => {
    const { redis, service } = build();
    for (let i = 0; i < 5; i++) await service.evaluate(MONITOR_ID, null, "DOWN");
    assert.equal(
      await redis.get(`rolling_stats:${MONITOR_ID}`),
      null,
      "a DOWN ping must not build a latency baseline",
    );
  });

  await test("still feeds flap detection", async () => {
    const { prisma, redis, service, advance } = build();

    // Every DOWN carries a null latency; every UP carries a real one.
    for (const status of ["UP", "DOWN", "UP", "DOWN", "UP"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }

    assert.equal(
      await redis.get(`flap_last:${MONITOR_ID}`),
      "UP",
      "last status should be tracked across null-latency pings",
    );
    assert.equal(
      prisma.events.filter((e) => e.type === "FLAPPING").length,
      1,
      "4 transitions including null-latency DOWNs should flag flapping",
    );
  });

  await test("a DOWN ping that does carry a latency is still not scored", async () => {
    const { redis, service } = build();
    // The pinger reports elapsed time even on failure (e.g. a 10s timeout).
    for (let i = 0; i < 8; i++) await service.evaluate(MONITOR_ID, 10_000, "DOWN");
    assert.equal(
      await redis.get(`rolling_stats:${MONITOR_ID}`),
      null,
      "time-to-failure must not enter the latency baseline",
    );
  });
}

// ─── 4. Concurrency ───────────────────────────────────────────────────────────

async function concurrencyTests(): Promise<void> {
  console.log("\nConcurrency (overlapping evaluations for one monitor)");

  await test("overlapping pings do not lose a rolling-stats update", async () => {
    const { redis, service } = build();

    // Seed the baseline, then fire 20 evaluations that all overlap in flight —
    // a retried job, or a second worker replica. A GET-then-SETEX pair loses
    // updates here; a single atomic script does not.
    await service.evaluate(MONITOR_ID, 100, "UP");
    await Promise.all(
      Array.from({ length: 20 }, () => service.evaluate(MONITOR_ID, 100, "UP")),
    );

    const raw = await redis.get(`rolling_stats:${MONITOR_ID}`);
    assert.ok(raw !== null, "rolling_stats should exist");
    const stats = JSON.parse(raw!) as { count: number };
    assert.equal(
      stats.count,
      21,
      `every ping should be folded in exactly once, got count=${stats.count}`,
    );
  });

  await test("overlapping pings do not double-count one transition", async () => {
    const { redis, service } = build();

    // Establish UP, then deliver five concurrent DOWN evaluations. They all
    // describe the *same* transition, so exactly one should be recorded:
    // `SET flap_last DOWN GET` lets only the first caller observe "UP".
    await service.evaluate(MONITOR_ID, 100, "UP");
    await Promise.all(
      Array.from({ length: 5 }, () => service.evaluate(MONITOR_ID, null, "DOWN")),
    );

    assert.equal(
      await redis.zcard(`flap_window:${MONITOR_ID}`),
      1,
      "one status change must produce one transition, not one per caller",
    );
  });
}

// ─── 5. Redis key isolation ───────────────────────────────────────────────────

async function keyIsolationTests(): Promise<void> {
  console.log("\nRedis key isolation");

  await test("never reads or writes current_status:{monitorId}", async () => {
    const { redis, service, advance } = build();

    // Seed the cache-aside entry exactly as PingService writes it.
    const cacheKey = `current_status:${MONITOR_ID}`;
    const cached = JSON.stringify({
      result: "UP",
      statusCode: 200,
      latencyMs: 100,
      checkedAt: new Date(1_700_000_000_000).toISOString(),
    });
    redis.strings.set(cacheKey, { value: cached, expiresAt: null });

    // Drive a full workload: warmup, a spike, and enough flapping to flag.
    for (let i = 0; i < 12; i++) {
      await service.evaluate(MONITOR_ID, 100, "UP");
      advance(1000);
    }
    await service.evaluate(MONITOR_ID, 900, "UP");
    await service.evaluate(MONITOR_ID, 900, "UP");
    for (const status of ["DOWN", "UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }

    assert.equal(
      redis.strings.get(cacheKey)?.value,
      cached,
      "the current_status cache entry was modified",
    );
    assert.ok(
      !redis.touched.has(cacheKey),
      "the service wrote to the current_status key",
    );
  });

  await test("uses only its own documented key namespaces", async () => {
    const { redis, service, advance } = build();
    for (let i = 0; i < 12; i++) await service.evaluate(MONITOR_ID, 100, "UP");
    await service.evaluate(MONITOR_ID, 900, "UP");
    await service.evaluate(MONITOR_ID, 900, "UP");
    for (const status of ["DOWN", "UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }

    const allowed = [
      `rolling_stats:${MONITOR_ID}`,
      `spike_alerted:${MONITOR_ID}`,
      `flap_window:${MONITOR_ID}`,
      `flap_last:${MONITOR_ID}`,
      `flap_alerted:${MONITOR_ID}`,
    ];
    const unexpected = [...redis.touched].filter((k) => !allowed.includes(k));
    assert.deepEqual(unexpected, [], "unexpected keys written");
  });

  await test("keeps per-monitor state separate", async () => {
    const { prisma, service } = build();
    // Monitor A is slow and steady, monitor B is fast and steady. Neither
    // should look anomalous to the other's baseline.
    for (let i = 0; i < 12; i++) {
      await service.evaluate("mon_a", 1000, "UP");
      await service.evaluate("mon_b", 50, "UP");
    }
    assert.equal(prisma.events.length, 0, "baselines leaked across monitors");
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("AnomalyDetectionService verification");
  await latencySpikeTests();
  await flappingTests();
  await nullLatencyTests();
  await concurrencyTests();
  await keyIsolationTests();

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
