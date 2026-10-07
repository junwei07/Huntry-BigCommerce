import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerClaim } from "@/lib/huntry/claims/player-claim";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

// Runs only against a real Postgres (SQLite can't exercise FOR UPDATE or
// advisory locks): HUNTRY_TEST_DATABASE_URL must point at a database already
// migrated with scripts/postgres/migrate.mjs. Skipped otherwise, so the normal
// `pnpm test` needs no Postgres.
const TEST_DATABASE_URL = process.env.HUNTRY_TEST_DATABASE_URL;

const issueCode = vi.hoisted(() => vi.fn());

vi.mock("@/lib/huntry/rewards/claim-codes", () => ({ issueClaimCode: issueCode }));

const STORE = "pgstore1";
const EGG_A = "00000000-0000-4000-8000-00000000000a";
const EGG_B = "00000000-0000-4000-8000-00000000000b";
const AT_EGG = { lat: 1.3, lng: 103.8 };

const claimInput = (customer: number, eggId = EGG_A) => ({ eggId, bcCustomerId: customer, ...AT_EGG });

describe.skipIf(!TEST_DATABASE_URL)("createPlayerClaim (Postgres)", () => {
  let pool: Pool;

  async function seed(options: { eggClaimCapacity?: number; maxGrabCount?: number; rewardEggCapacity?: number } = {}) {
    await pool.query("TRUNCATE huntry_claims, huntry_eggs, huntry_rewards, huntry_events RESTART IDENTITY CASCADE");
    await pool.query("INSERT INTO users (user_id, email) VALUES (1, 'a@example.com') ON CONFLICT DO NOTHING");
    await pool.query(
      `INSERT INTO stores (store_hash, access_token, scope, admin_user_id) VALUES ($1, 'x', 'x', 1)
       ON CONFLICT (store_hash) DO NOTHING`,
      [STORE],
    );
    await pool.query(
      `INSERT INTO huntry_events (store_hash, name, slug, starts_at, marker_radius_meters, max_grab_count, egg_claim_capacity)
       VALUES ($1, 'Hunt', 'hunt', now() - interval '1 day', 25, $2, $3)`,
      [STORE, options.maxGrabCount ?? 0, options.eggClaimCapacity ?? 1],
    );
    await pool.query(
      `INSERT INTO huntry_rewards (store_hash, name, egg_capacity, discount_type, discount_value, coupon_code, bc_promotion_id)
       VALUES ($1, 'Coffee', $2, 'percent', 10, 'COFFEE', '9')`,
      [STORE, options.rewardEggCapacity ?? 100],
    );

    for (const id of [EGG_A, EGG_B]) {
      await pool.query(
        "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, lat, lng) VALUES ($1, $2, 1, 1, 1.3, 103.8)",
        [id, STORE],
      );
    }
  }

  async function countClaims(): Promise<number> {
    return Number((await pool.query("SELECT COUNT(*) AS n FROM huntry_claims")).rows[0].n);
  }

  beforeAll(() => {
    process.env.DATA_MODE = "MULTITENANT";
    process.env.CREDENTIALS_STORE_DRIVER = "POSTGRES";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.DATABASE_POOL_MAX = "30";
    pool = getHuntryDb() as Pool;
  });

  beforeEach(() => {
    issueCode.mockReset();

    let issued = 0;

    issueCode.mockImplementation(async () => `COFFEE-CODE${++issued}`);
  });

  afterAll(async () => {
    await pool?.end();
    delete process.env.DATA_MODE;
    delete process.env.CREDENTIALS_STORE_DRIVER;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POOL_MAX;
  });

  it("creates a claim and stores the snapshot", async () => {
    await seed();

    const result = await createPlayerClaim(claimInput(42), STORE);

    expect(result.status).toBe("created");
    expect(issueCode).toHaveBeenCalledWith(expect.objectContaining({ id: 1, bcPromotionId: "9" }), STORE);
    expect((await pool.query("SELECT * FROM huntry_claims")).rows[0]).toMatchObject({
      egg_id: EGG_A,
      bc_customer_id: 42,
      coupon_code: "COFFEE-CODE1",
      is_forced: false,
    });
  });

  it("reports a duplicate with the existing code", async () => {
    await seed({ eggClaimCapacity: 5 });
    await createPlayerClaim(claimInput(42), STORE);

    expect(await createPlayerClaim(claimInput(42), STORE)).toEqual({ status: "duplicate", couponCode: "COFFEE-CODE1" });
  });

  it("applies the cooldown to a second claim by the same customer", async () => {
    await seed({ eggClaimCapacity: 5 });
    await createPlayerClaim(claimInput(42, EGG_A), STORE);

    expect((await createPlayerClaim(claimInput(42, EGG_B), STORE)).status).toBe("cooldown");
  });

  it("uses elapsed time, not transaction time: an old claim far away trips the speed check", async () => {
    await seed({ eggClaimCapacity: 5 });
    // 10 s ago and ~1.1 km away -> well above 20 m/s once the cooldown passed.
    await pool.query(
      `INSERT INTO huntry_claims (store_hash, egg_id, reward_id, event_id, reward_name_snapshot, bc_customer_id, coupon_code, claim_lat, claim_lng, claimed_at)
       VALUES ($1, $2, 1, 1, 'Coffee', 42, 'COFFEE', 1.31, 103.8, now() - interval '10 seconds')`,
      [STORE, "00000000-0000-4000-8000-0000000000cc"],
    );

    expect((await createPlayerClaim(claimInput(42, EGG_A), STORE)).status).toBe("too_fast");
  });

  it("leaves no claim row when issuing the code fails", async () => {
    await seed();
    issueCode.mockRejectedValueOnce(new Error("BigCommerce down"));

    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("code_issue_failed");
    expect(await countClaims()).toBe(0);
    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("created");
  });

  describe("concurrency", () => {
    it("lets exactly one of many parallel claimers take a capacity-1 egg", async () => {
      await seed();

      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => createPlayerClaim(claimInput(100 + i), STORE)),
      );

      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      expect(results.filter((r) => r.status === "capacity_full")).toHaveLength(11);
      expect(await countClaims()).toBe(1);
    });

    it("never lets one customer exceed max_grab_count across different eggs", async () => {
      await seed({ maxGrabCount: 1, eggClaimCapacity: 5 });

      // Without the per-customer advisory lock both would see zero prior
      // claims and both would commit.
      const results = await Promise.all([
        createPlayerClaim(claimInput(42, EGG_A), STORE),
        createPlayerClaim(claimInput(42, EGG_B), STORE),
      ]);

      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      expect(await countClaims()).toBe(1);
    });

    it("never exceeds the reward budget across different eggs", async () => {
      // egg_capacity 1 x claim capacity 1 = a budget of exactly one claim.
      await seed({ rewardEggCapacity: 1 });

      const results = await Promise.all([
        createPlayerClaim(claimInput(101, EGG_A), STORE),
        createPlayerClaim(claimInput(102, EGG_B), STORE),
      ]);

      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      expect(results.filter((r) => r.status === "capacity_full")).toHaveLength(1);
      expect(await countClaims()).toBe(1);
    });

    it("creates one claim for the same customer and egg fired in parallel", async () => {
      await seed({ eggClaimCapacity: 5 });

      const results = await Promise.all(Array.from({ length: 6 }, () => createPlayerClaim(claimInput(42), STORE)));

      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      expect(await countClaims()).toBe(1);
    });

    it("does not deadlock when customers claim eggs in opposite orders", async () => {
      await seed({ eggClaimCapacity: 100 });

      for (let i = 0; i < 10; i++) {
        const results = await Promise.all([
          createPlayerClaim(claimInput(1000 + 2 * i, EGG_A), STORE),
          createPlayerClaim(claimInput(1001 + 2 * i, EGG_B), STORE),
          createPlayerClaim(claimInput(2000 + 2 * i, EGG_B), STORE),
          createPlayerClaim(claimInput(2001 + 2 * i, EGG_A), STORE),
        ]);

        expect(results.map((r) => r.status)).toEqual(["created", "created", "created", "created"]);
      }
    });
  });

  it("returns lock_timeout and writes nothing when the egg row is held", async () => {
    await seed();

    const holder = await pool.connect();

    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM huntry_eggs WHERE id = $1 FOR UPDATE", [EGG_A]);

      expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("lock_timeout");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    expect(await countClaims()).toBe(0);
    // The pool recovered: the same claim succeeds once the lock is free.
    expect((await createPlayerClaim(claimInput(42), STORE)).status).toBe("created");
  }, 20000);
});
