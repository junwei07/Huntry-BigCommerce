import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createForcedClaim, fetchEggClaimCounts, listClaimsForCustomer } from "@/lib/huntry/claims/claims-api";
import { addMockForcedClaim, MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { CreateForcedClaimInput } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

const EGG_ID = "00000000-0000-4000-8000-000000000001";

const input: CreateForcedClaimInput = {
  eggId: EGG_ID,
  rewardId: 1,
  eventId: 1,
  rewardNameSnapshot: "Free Coffee",
  bcCustomerId: 42,
  couponCode: "COFFEE",
  forcedByUserId: 7,
};

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-claims-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
});

afterEach(() => {
  delete process.env.DATA_MODE;

  // Best-effort — see get-db.test.ts's afterEach (Windows file lock).
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

describe("createForcedClaim (SQLite)", () => {
  it("inserts a forced claim with the audit columns and snapshots", async () => {
    const result = await createForcedClaim(input, "store1");

    expect(result.status).toBe("created");

    const row = (getHuntryDb() as DatabaseSync).prepare("SELECT * FROM huntry_claims").get() as Record<string, unknown>;

    expect(row).toMatchObject({
      store_hash: "store1",
      egg_id: EGG_ID,
      reward_name_snapshot: "Free Coffee",
      bc_customer_id: 42,
      coupon_code: "COFFEE",
      is_forced: 1,
      forced_by_user_id: 7,
    });

    if (result.status === "created") {
      expect(result.claim.isForced).toBe(true);
      expect(result.claim.forcedByUserId).toBe(7);
    }
  });

  it("reports a duplicate for the same egg and customer", async () => {
    await createForcedClaim(input, "store1");

    expect((await createForcedClaim(input, "store1")).status).toBe("duplicate");
    expect((await createForcedClaim({ ...input, bcCustomerId: 43 }, "store1")).status).toBe("created");
  });
});

describe("addMockForcedClaim", () => {
  it("rejects a duplicate egg/customer pair", () => {
    const before = MOCK_CLAIMS.length;

    expect(addMockForcedClaim({ ...input, bcCustomerId: 9001 }).status).toBe("created");
    expect(addMockForcedClaim({ ...input, bcCustomerId: 9001 }).status).toBe("duplicate");
    expect(MOCK_CLAIMS.length).toBe(before + 1);
  });
});

describe("listClaimsForCustomer (SQLite)", () => {
  it("returns only this store's and customer's claims, newest first, with claimed_at read as UTC", async () => {
    const egg = (n: number) => `00000000-0000-4000-8000-0000000001${n}0`;

    await createForcedClaim({ ...input, eggId: egg(1), couponCode: "OLD", bcCustomerId: 4242 }, "store1");
    await createForcedClaim({ ...input, eggId: egg(2), couponCode: "NEW", bcCustomerId: 4242 }, "store1");
    await createForcedClaim({ ...input, eggId: egg(3), couponCode: "OTHER-CUSTOMER", bcCustomerId: 4299 }, "store1");
    await createForcedClaim({ ...input, eggId: egg(4), couponCode: "OTHER-STORE", bcCustomerId: 4242 }, "store2");

    const db = getHuntryDb() as DatabaseSync;

    db.prepare("UPDATE huntry_claims SET claimed_at = '2026-10-01 10:00:00' WHERE coupon_code = 'OLD'").run();
    db.prepare("UPDATE huntry_claims SET claimed_at = '2026-10-02 10:00:00' WHERE coupon_code = 'NEW'").run();

    const claims = await listClaimsForCustomer("store1", 4242);

    expect(claims.map((claim) => claim.couponCode)).toEqual(["NEW", "OLD"]);
    // datetime('now') is UTC; reading it as local time would shift this by the host's offset.
    expect(claims[0].claimedAt.toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });

  it("returns nothing for a customer with no claims", async () => {
    expect(await listClaimsForCustomer("store1", 1)).toEqual([]);
  });
});

describe("fetchEggClaimCounts (SQLite)", () => {
  it("counts claims per egg for the event, forced ones included and flagged", async () => {
    const egg = (n: number) => `00000000-0000-4000-8000-0000000002${n}0`;
    const forced = (eggId: string, bcCustomerId: number, eventId = 31) =>
      createForcedClaim({ ...input, eggId, eventId, bcCustomerId, couponCode: `CODE-${eggId.slice(-4)}-${bcCustomerId}` }, "store1");

    await forced(egg(1), 501);
    await forced(egg(1), 502);
    await forced(egg(2), 501);
    await forced(egg(3), 501, 32);

    // Make egg 2's claim a player claim.
    (getHuntryDb() as DatabaseSync).prepare("UPDATE huntry_claims SET is_forced = 0 WHERE egg_id = ?").run(egg(2));

    const counts = await fetchEggClaimCounts(31, "store1");

    expect(counts.get(egg(1))).toEqual({ count: 2, forced: 2 });
    expect(counts.get(egg(2))).toEqual({ count: 1, forced: 0 });
    // Another event's claims, other stores and unclaimed eggs are absent.
    expect(counts.has(egg(3))).toBe(false);
    expect((await fetchEggClaimCounts(31, "store2")).size).toBe(0);
  });
});
