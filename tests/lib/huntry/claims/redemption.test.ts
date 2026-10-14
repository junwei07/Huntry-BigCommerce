import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { evaluateRedemption, normalizeCouponCode, RedemptionCandidate } from "@/lib/huntry/claims/redemption";

function candidate(id: number, bcCustomerId: number, couponCode: string): RedemptionCandidate {
  return { id, eventId: 1, bcCustomerId, couponCode, redemptionStatus: "unredeemed" };
}

describe("normalizeCouponCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeCouponCode("  hunt-ab12cd34 ")).toBe("HUNT-AB12CD34");
  });
});

describe("evaluateRedemption", () => {
  it("marks a claim redeemed when the order's customer owns the code", () => {
    expect(evaluateRedemption(42, [candidate(1, 42, "HUNT-AAAA1111")])).toEqual([{ claimId: 1, status: "redeemed" }]);
  });

  it("flags a claim whose code was used by a different customer", () => {
    expect(evaluateRedemption(99, [candidate(1, 42, "HUNT-AAAA1111")])).toEqual([
      { claimId: 1, status: "flagged_unauthorized_use" },
    ]);
  });

  it("flags a guest order (customer_id 0)", () => {
    expect(evaluateRedemption(0, [candidate(1, 42, "HUNT-AAAA1111")])).toEqual([
      { claimId: 1, status: "flagged_unauthorized_use" },
    ]);
  });

  it("marks each of a customer's claims by its own code (several claims on one reward)", () => {
    expect(
      evaluateRedemption(42, [candidate(1, 42, "HUNT-AAAA1111"), candidate(2, 42, "HUNT-BBBB2222")]),
    ).toEqual([
      { claimId: 1, status: "redeemed" },
      { claimId: 2, status: "redeemed" },
    ]);
  });

  it("only touches the claims whose codes were on the order", () => {
    expect(evaluateRedemption(42, [candidate(1, 42, "HUNT-AAAA1111")])).toHaveLength(1);
    expect(evaluateRedemption(42, [])).toEqual([]);
  });

  it("breaks a duplicate-code tie with the order's customer", () => {
    const claims = [candidate(1, 41, "HUNT-DUPE0000"), candidate(2, 42, "HUNT-DUPE0000")];

    expect(evaluateRedemption(42, claims)).toEqual([{ claimId: 2, status: "redeemed" }]);
    expect(evaluateRedemption(7, claims)).toEqual([
      { claimId: 1, status: "flagged_unauthorized_use" },
      { claimId: 2, status: "flagged_unauthorized_use" },
    ]);
  });
});

// A fresh module graph per test so get-db's singleton opens a new temp file
// instead of carrying rows over from the previous test.
let tempDir: string;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-redemption-test-"));
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

let nextEgg = 1;

async function loadModules() {
  const claims = await import("@/lib/huntry/claims/claims-api");
  const redemption = await import("@/lib/huntry/claims/redemption");
  const { getHuntryDb } = await import("@/lib/huntry/db/get-db");

  async function seed(storeHash: string, bcCustomerId: number, couponCode: string): Promise<number | string> {
    const eggId = `00000000-0000-4000-8000-${String(nextEgg++).padStart(12, "0")}`;
    const result = await claims.createForcedClaim(
      { eggId, rewardId: 1, eventId: 1, rewardNameSnapshot: "Free Coffee", bcCustomerId, couponCode, forcedByUserId: null },
      storeHash,
    );

    if (result.status !== "created") {
      throw new Error("seed failed");
    }

    return result.claim.id;
  }

  function row(id: number | string) {
    return (getHuntryDb() as DatabaseSync).prepare("SELECT * FROM huntry_claims WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
  }

  return { redemption, seed, row };
}

function fakeClient(order: unknown, coupons: unknown): BcRestApiClient {
  return {
    async get(path: string) {
      return { data: path.endsWith("/coupons") ? coupons : order, headers: new Headers() } as never;
    },
    async post() {
      throw new Error("not used");
    },
    async put() {
      throw new Error("not used");
    },
    async delete() {
      throw new Error("not used");
    },
  };
}

describe("processOrderCreated (SQLite)", () => {
  it("marks the claimer's claim redeemed and records the order id", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");

    const result = await redemption.processOrderCreated(
      "store1",
      500,
      fakeClient({ customer_id: 42 }, [{ code: "HUNT-AAAA1111" }]),
    );

    expect(result).toEqual({ matched: 1, updated: 1, eventIds: [1] });
    expect(row(id)).toMatchObject({ redemption_status: "redeemed", order_id: 500 });
  });

  it("matches a code the shopper typed in lowercase", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");

    await redemption.processOrderCreated("store1", 501, fakeClient({ customer_id: 42 }, [{ code: " hunt-aaaa1111 " }]));

    expect(row(id).redemption_status).toBe("redeemed");
  });

  it("flags a claim whose code a different customer used", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");

    await redemption.processOrderCreated("store1", 502, fakeClient({ customer_id: 99 }, [{ code: "HUNT-AAAA1111" }]));

    expect(row(id)).toMatchObject({ redemption_status: "flagged_unauthorized_use", order_id: 502 });
  });

  it("marks only the claims whose codes were on the order (multi-claim customer)", async () => {
    const { redemption, seed, row } = await loadModules();
    const first = await seed("store1", 42, "HUNT-AAAA1111");
    const second = await seed("store1", 42, "HUNT-BBBB2222");

    await redemption.processOrderCreated("store1", 503, fakeClient({ customer_id: 42 }, [{ code: "HUNT-AAAA1111" }]));

    expect(row(first).redemption_status).toBe("redeemed");
    expect(row(second)).toMatchObject({ redemption_status: "unredeemed", order_id: null });
  });

  it("is idempotent: a redelivery or later order never flips a decided claim", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");

    await redemption.processOrderCreated("store1", 504, fakeClient({ customer_id: 42 }, [{ code: "HUNT-AAAA1111" }]));

    const again = await redemption.processOrderCreated(
      "store1",
      505,
      fakeClient({ customer_id: 99 }, [{ code: "HUNT-AAAA1111" }]),
    );

    expect(again.updated).toBe(0);
    expect(again.eventIds).toEqual([]);
    expect(row(id)).toMatchObject({ redemption_status: "redeemed", order_id: 504 });
  });

  it("never touches another store's claims", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store2", 42, "HUNT-AAAA1111");

    const result = await redemption.processOrderCreated(
      "store1",
      506,
      fakeClient({ customer_id: 42 }, [{ code: "HUNT-AAAA1111" }]),
    );

    expect(result).toEqual({ matched: 0, updated: 0, eventIds: [] });
    expect(row(id).redemption_status).toBe("unredeemed");
  });

  it("treats an order with no coupons (204 -> undefined) and non-Huntry codes as a no-op", async () => {
    const { redemption, seed, row } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");

    expect(await redemption.processOrderCreated("store1", 507, fakeClient({ customer_id: 42 }, undefined))).toEqual({
      matched: 0,
      updated: 0,
      eventIds: [],
    });
    expect(
      await redemption.processOrderCreated("store1", 508, fakeClient({ customer_id: 42 }, [{ code: "SUMMER10" }])),
    ).toEqual({ matched: 0, updated: 0, eventIds: [] });
    expect(row(id).redemption_status).toBe("unredeemed");
  });

  it("throws when the re-fetched order has no customer_id", async () => {
    const { redemption } = await loadModules();

    await expect(redemption.processOrderCreated("store1", 509, fakeClient({}, []))).rejects.toThrow(/customer_id/);
  });
});
