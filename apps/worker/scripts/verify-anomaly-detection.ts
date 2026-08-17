/**
 * Behavioural verification for AnomalyDetectionService.
 *
 * This repo has no test runner wired up (see README note added with this
 * commit), so this is a standalone script rather than a unit test file: run it
 * with `pnpm --filter @sentinel/worker verify:anomaly`. It adds no dependencies
 * and needs neither Postgres nor Redis — both are replaced with in-process
 * fakes, so it is safe to run anywhere, including CI.
 *
 * It lives outside src/ because tsconfig sets rootDir: ./src, so nothing here
 * is compiled into dist/ or shipped in the worker image.
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

/** Minimal ioredis stand-in covering exactly the commands the service issues. */
class FakeRedis {
  strings = new Map<string, string>();
  zsets = new Map<string, Map<string, number>>();
  /** Every key the service has ever written, for the collision check. */
  touched = new Set<string>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async setex(key: string, _ttl: number, value: string): Promise<"OK"> {
    this.touched.add(key);
    this.strings.set(key, value);
    return "OK";
  }

  async set(
    key: string,
    value: string,
    _ex: "EX",
    _ttl: number,
    nx: "NX",
  ): Promise<"OK" | null> {
    if (nx === "NX" && this.strings.has(key)) return null;
    this.touched.add(key);
    this.strings.set(key, value);
    return "OK";
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  private zaddSync(key: string, score: number, member: string): void {
    this.touched.add(key);
    const set = this.zsets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
  }

  private zremrangebyscoreSync(key: string, min: string, max: number): void {
    const set = this.zsets.get(key);
    if (!set) return;
    const lo = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    for (const [member, score] of set) {
      if (score >= lo && score <= max) set.delete(member);
    }
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
      expire: (_key: string, _ttl: number) => chain,
      exec: async () => {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
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
  const redis = new FakeRedis();
  let clock = startMs;
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
    "fires exactly once, on the spike ping and not before",
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

      // The deliberate spike.
      await service.evaluate(MONITOR_ID, 900, "UP");

      assert.equal(prisma.events.length, 1, "expected exactly one event");
      const event = prisma.events[0]!;
      assert.equal(event.type, "LATENCY_SPIKE");
      assert.equal(event.monitorId, MONITOR_ID);
      assert.equal(event.value, 900, "value should be the observed latency");
      assert.ok(
        event.baseline > 90 && event.baseline < 110,
        `baseline should be the pre-spike EWMA (~100ms), got ${event.baseline}`,
      );
    },
  );

  await test("does not fire during warmup, before MIN_SAMPLES", async () => {
    const { prisma, service } = build();
    // A spike on the 3rd ping: real deviation, but no trustworthy baseline yet.
    for (const latency of [100, 102, 900]) {
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

// ─── 4. Redis key isolation ───────────────────────────────────────────────────

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
    redis.strings.set(cacheKey, cached);

    // Drive a full workload: warmup, a spike, and enough flapping to flag.
    for (let i = 0; i < 12; i++) {
      await service.evaluate(MONITOR_ID, 100, "UP");
      advance(1000);
    }
    await service.evaluate(MONITOR_ID, 900, "UP");
    for (const status of ["DOWN", "UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }

    assert.equal(
      redis.strings.get(cacheKey),
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
    for (const status of ["DOWN", "UP", "DOWN", "UP", "DOWN"] as const) {
      await service.evaluate(MONITOR_ID, status === "UP" ? 100 : null, status);
      advance(60_000);
    }

    const allowed = [
      `rolling_stats:${MONITOR_ID}`,
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
  await keyIsolationTests();

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
