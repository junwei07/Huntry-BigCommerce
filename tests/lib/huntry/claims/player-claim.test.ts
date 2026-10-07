import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimContext, createPlayerClaim, evaluateClaim } from "@/lib/huntry/claims/player-claim";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

const issueCode = vi.hoisted(() => vi.fn());

vi.mock("@/lib/huntry/rewards/claim-codes", () => ({ issueClaimCode: issueCode }));

const STORE = "store1";
const EGG_A = "00000000-0000-4000-8000-00000000000a";
const EGG_B = "00000000-0000-4000-8000-00000000000b";
const NOW = new Date("2026-06-01T12:00:00Z");

function baseContext(overrides: Partial<ClaimContext> = {}): ClaimContext {
  return {
    egg: { lat: 1.3, lng: 103.8 },
    event: {
      startsAt: new Date("2026-05-01T00:00:00Z"),
      endsAt: null,
      markerRadiusMeters: 25,
      maxGrabCount: 0,
      eggClaimCapacity: 1,
    },
    reward: {
      id: 1,
      name: "Coffee",
      status: "active",
      couponCode: "COFFEE",
      bcPromotionId: "9",
      eggCapacity: 5,
      startsAt: null,
      expiresAt: null,
      placedEggClaimCapacities: [1],
    },
    counts: { egg: 0, reward: 0, customerInEvent: 0 },
    existingCouponCode: null,
    lastClaim: null,
    ...overrides,
  };
}

const AT_EGG = { lat: 1.3, lng: 103.8 };

describe("evaluateClaim", () => {
  it("accepts a valid claim", () => {
    expect(evaluateClaim(baseContext(), AT_EGG, NOW)).toEqual({ ok: true });
  });

  it("rejects an event that is not live", () => {
    const context = baseContext();

    context.event.endsAt = new Date("2026-05-02T00:00:00Z");
    expect(evaluateClaim(context, AT_EGG, NOW)).toEqual({ status: "event_not_live" });
  });

  it("rejects an unsynced or expired reward", () => {
    const unsynced = baseContext();
    const expired = baseContext();

    unsynced.reward.bcPromotionId = null;
    expired.reward.expiresAt = new Date("2026-05-31T00:00:00Z");
    expect(evaluateClaim(unsynced, AT_EGG, NOW)).toEqual({ status: "reward_unavailable" });
    expect(evaluateClaim(expired, AT_EGG, NOW)).toEqual({ status: "reward_unavailable" });
  });

  it("returns the existing code for a duplicate", () => {
    expect(evaluateClaim(baseContext({ existingCouponCode: "COFFEE" }), AT_EGG, NOW)).toEqual({
      status: "duplicate",
      couponCode: "COFFEE",
    });
  });

  it("rejects a claim outside the marker radius", () => {
    expect(evaluateClaim(baseContext(), { lat: 1.31, lng: 103.8 }, NOW)).toEqual({ status: "too_far" });
  });

  it("enforces egg and reward capacity", () => {
    expect(evaluateClaim(baseContext({ counts: { egg: 1, reward: 1, customerInEvent: 0 } }), AT_EGG, NOW)).toEqual({
      status: "capacity_full",
    });
    expect(evaluateClaim(baseContext({ counts: { egg: 0, reward: 5, customerInEvent: 0 } }), AT_EGG, NOW)).toEqual({
      status: "capacity_full",
    });
  });

  it("enforces the per-player event limit, 0 meaning unlimited", () => {
    const limited = baseContext({ counts: { egg: 0, reward: 0, customerInEvent: 2 } });

    limited.event.maxGrabCount = 2;
    expect(evaluateClaim(limited, AT_EGG, NOW)).toEqual({ status: "limit_reached" });
    expect(evaluateClaim(baseContext({ counts: { egg: 0, reward: 0, customerInEvent: 99 } }), AT_EGG, NOW)).toEqual({
      ok: true,
    });
  });

  it("applies the cooldown and the speed check", () => {
    const recent = baseContext({ lastClaim: { lat: null, lng: null, elapsedSeconds: 1 } });
    const fast = baseContext({ lastClaim: { lat: 1.29, lng: 103.8, elapsedSeconds: 10 } });
    const plausible = baseContext({ lastClaim: { lat: 1.2999, lng: 103.8, elapsedSeconds: 60 } });

    expect(evaluateClaim(recent, AT_EGG, NOW)).toEqual({ status: "cooldown" });
    expect(evaluateClaim(fast, AT_EGG, NOW)).toEqual({ status: "too_fast" });
    expect(evaluateClaim(plausible, AT_EGG, NOW)).toEqual({ ok: true });
  });
});

let tempDir: string;

function seed(options: { eggClaimCapacity?: number; maxGrabCount?: number } = {}): DatabaseSync {
  const db = getHuntryDb() as DatabaseSync;

  // get-db.ts caches one connection per process, so rows outlive a test.
  for (const table of ["huntry_claims", "huntry_eggs", "huntry_rewards", "huntry_events"]) {
    db.exec(`DELETE FROM ${table}`);
  }

  db.prepare(
    `INSERT INTO huntry_events (id, store_hash, name, slug, starts_at, marker_radius_meters, max_grab_count, egg_claim_capacity)
     VALUES (1, ?, 'Hunt', 'hunt', '2026-01-01T00:00:00.000Z', 25, ?, ?)`,
  ).run(STORE, options.maxGrabCount ?? 0, options.eggClaimCapacity ?? 1);
  db.prepare(
    `INSERT INTO huntry_rewards (id, store_hash, name, egg_capacity, discount_type, discount_value, coupon_code, bc_promotion_id)
     VALUES (1, ?, 'Coffee', 5, 'percent', 10, 'COFFEE', '9')`,
  ).run(STORE);

  for (const id of [EGG_A, EGG_B]) {
    db.prepare("INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, lat, lng) VALUES (?, ?, 1, 1, 1.3, 103.8)").run(
      id,
      STORE,
    );
  }

  return db;
}

const claimInput = (customer: number, eggId = EGG_A) => ({ eggId, bcCustomerId: customer, ...AT_EGG });

function countClaims(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM huntry_claims").get() as { n: number }).n;
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-player-claim-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  issueCode.mockReset();

  let issued = 0;

  issueCode.mockImplementation(async () => `COFFEE-CODE${++issued}`);
});

afterEach(() => {
  delete process.env.DATA_MODE;

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort — Windows file lock, see claims-api.test.ts.
  }
});

describe("createPlayerClaim (SQLite)", () => {
  it("issues a per-claim code and stores it on the claim", async () => {
    const db = seed();
    const result = await createPlayerClaim(claimInput(42), STORE);

    expect(result.status).toBe("created");
    expect(issueCode).toHaveBeenCalledWith(expect.objectContaining({ id: 1, bcPromotionId: "9", couponCode: "COFFEE" }), STORE);
    expect(db.prepare("SELECT * FROM huntry_claims").get()).toMatchObject({
      egg_id: EGG_A,
      bc_customer_id: 42,
      coupon_code: "COFFEE-CODE1",
      reward_name_snapshot: "Coffee",
      is_forced: 0,
    });
  });

  it("returns egg_not_found for an unknown egg", async () => {
    seed();
    expect((await createPlayerClaim(claimInput(42, "00000000-0000-4000-8000-0000000000ff"), STORE)).status).toBe(
      "egg_not_found",
    );
  });

  it("leaves no claim row when issuing the code fails", async () => {
    const db = seed();

    issueCode.mockRejectedValueOnce(new Error("BigCommerce down"));

    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("code_issue_failed");
    expect(countClaims(db)).toBe(0);
    // The failed attempt must not trip the duplicate/cooldown rules.
    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("created");
  });

  it("reports a duplicate with the existing code", async () => {
    seed();
    await createPlayerClaim(claimInput(42), STORE);

    expect(await createPlayerClaim(claimInput(42), STORE)).toEqual({ status: "duplicate", couponCode: "COFFEE-CODE1" });
  });
});

describe("createPlayerClaim distinct codes (SQLite)", () => {
  it("gives every claim its own code, so one customer can hold several rewards", async () => {
    const db = seed({ eggClaimCapacity: 5 });

    // Different customers on one egg: distinct codes, never the shared prefix.
    await createPlayerClaim(claimInput(1), STORE);
    await createPlayerClaim(claimInput(2), STORE);

    const codes = (db.prepare("SELECT coupon_code FROM huntry_claims").all() as { coupon_code: string }[]).map(
      (row) => row.coupon_code,
    );

    expect(new Set(codes).size).toBe(2);
    expect(codes).not.toContain("COFFEE");
  });

  it("refuses a reward that was never synced to a promotion", async () => {
    const db = seed();

    db.exec("UPDATE huntry_rewards SET bc_promotion_id = NULL");

    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("reward_unavailable");
    expect(issueCode).not.toHaveBeenCalled();
    expect(countClaims(db)).toBe(0);
  });
});

describe("createPlayerClaim concurrency (SQLite)", () => {
  it("lets exactly one of many parallel claimers take a capacity-1 egg", async () => {
    const db = seed();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createPlayerClaim(claimInput(100 + i), STORE)));

    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "capacity_full")).toHaveLength(11);
    expect(countClaims(db)).toBe(1);
  });

  it("enforces max_grab_count across different eggs for one customer", async () => {
    const db = seed({ maxGrabCount: 1 });
    // Same customer, two eggs, fired together. The 3s cooldown would also
    // refuse the second, so assert the invariant (never more than one claim)
    // rather than which rule fired.
    const results = await Promise.all([createPlayerClaim(claimInput(42, EGG_A), STORE), createPlayerClaim(claimInput(42, EGG_B), STORE)]);

    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(countClaims(db)).toBe(1);
  });

  it("allows one claim for the same customer and egg fired in parallel", async () => {
    const db = seed({ eggClaimCapacity: 5 });
    const results = await Promise.all(Array.from({ length: 6 }, () => createPlayerClaim(claimInput(42), STORE)));

    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(countClaims(db)).toBe(1);
  });
});
