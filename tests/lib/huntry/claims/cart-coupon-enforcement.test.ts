import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { evaluateCartCoupons } from "@/lib/huntry/claims/cart-coupon-enforcement";
import type { RedemptionCandidate } from "@/lib/huntry/claims/redemption";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

function claim(id: number, bcCustomerId: number, couponCode: string): RedemptionCandidate {
  return { id, eventId: 1, bcCustomerId, couponCode, redemptionStatus: "unredeemed" };
}

const keepGuests = { removeGuest: false };
const removeGuests = { removeGuest: true };

describe("evaluateCartCoupons", () => {
  const claims = [claim(1, 42, "HUNT-AAAA1111")];

  it("keeps a code on its claimer's cart", () => {
    expect(evaluateCartCoupons(42, ["HUNT-AAAA1111"], claims, keepGuests)).toEqual([]);
  });

  it("removes a code on another customer's cart", () => {
    expect(evaluateCartCoupons(99, ["HUNT-AAAA1111"], claims, keepGuests)).toEqual(["HUNT-AAAA1111"]);
  });

  it("matches case-insensitively and returns the code as the cart reports it", () => {
    expect(evaluateCartCoupons(99, [" hunt-aaaa1111 "], claims, keepGuests)).toEqual([" hunt-aaaa1111 "]);
    expect(evaluateCartCoupons(42, ["hunt-aaaa1111"], claims, keepGuests)).toEqual([]);
  });

  it("never touches a code that is not a claim (an ordinary store coupon)", () => {
    expect(evaluateCartCoupons(99, ["SUMMER10"], claims, keepGuests)).toEqual([]);
  });

  it("leaves a guest cart alone by default, so a not-yet-associated login can't lose its code", () => {
    expect(evaluateCartCoupons(0, ["HUNT-AAAA1111"], claims, keepGuests)).toEqual([]);
  });

  it("removes a claim code from a guest cart once guest removal is enabled", () => {
    expect(evaluateCartCoupons(0, ["HUNT-AAAA1111"], claims, removeGuests)).toEqual(["HUNT-AAAA1111"]);
  });

  it("only removes the foreign codes among several", () => {
    const several = [claim(1, 42, "HUNT-AAAA1111"), claim(2, 43, "HUNT-BBBB2222")];

    expect(evaluateCartCoupons(42, ["HUNT-AAAA1111", "HUNT-BBBB2222", "SUMMER10"], several, keepGuests)).toEqual([
      "HUNT-BBBB2222",
    ]);
  });

  it("keeps a duplicate-code row's code for the customer who owns one of the rows", () => {
    const dupes = [claim(1, 41, "HUNT-DUPE0000"), claim(2, 42, "HUNT-DUPE0000")];

    expect(evaluateCartCoupons(42, ["HUNT-DUPE0000"], dupes, keepGuests)).toEqual([]);
    expect(evaluateCartCoupons(7, ["HUNT-DUPE0000"], dupes, keepGuests)).toEqual(["HUNT-DUPE0000"]);
  });
});

// A fresh module graph per test so get-db's singleton opens a new temp file.
let tempDir: string;
let nextEgg = 1;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-cart-coupons-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  delete process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS;
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
});

afterEach(() => {
  delete process.env.DATA_MODE;
  delete process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS;

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort — Windows file lock, see get-db.test.ts.
  }
});

async function loadModules() {
  const claims = await import("@/lib/huntry/claims/claims-api");
  const enforcement = await import("@/lib/huntry/claims/cart-coupon-enforcement");
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

  function statusOf(id: number | string) {
    return (
      (getHuntryDb() as DatabaseSync).prepare("SELECT redemption_status FROM huntry_claims WHERE id = ?").get(id) as {
        redemption_status: string;
      }
    ).redemption_status;
  }

  return { enforcement, seed, statusOf };
}

function fakeClient(
  checkouts: unknown[],
  options: { deleteError?: (code: string) => Error | undefined } = {},
) {
  const reads: string[] = [];
  const deletes: { path: string; body: unknown }[] = [];
  const client: BcRestApiClient = {
    async get(path: string) {
      reads.push(path);

      return { data: checkouts[Math.min(reads.length, checkouts.length) - 1], headers: new Headers() } as never;
    },
    async post() {
      throw new Error("not used");
    },
    async put() {
      throw new Error("not used");
    },
    async delete(path: string, mutation) {
      deletes.push({ path, body: mutation?.body });

      const error = options.deleteError?.(decodeURIComponent(path.split("/").pop() ?? ""));

      if (error) {
        throw error;
      }

      return { data: undefined, headers: new Headers() } as never;
    },
  };

  return { client, reads, deletes };
}

const checkout = (customerId: unknown, codes: string[]) => ({
  data: { cart: { customer_id: customerId }, coupons: codes.map((code) => ({ code })) },
});

describe("enforceCartCoupons (SQLite)", () => {
  it("deletes a claim code applied to another customer's cart", async () => {
    const { enforcement, seed, statusOf } = await loadModules();
    const id = await seed("store1", 42, "HUNT-AAAA1111");
    const { client, deletes } = fakeClient([checkout(99, ["HUNT-AAAA1111"])]);

    const result = await enforcement.enforceCartCoupons("store1", "cart-1", client);

    expect(result).toEqual({ removed: ["HUNT-AAAA1111"] });
    expect(deletes).toEqual([{ path: "/v3/checkouts/cart-1/coupons/HUNT-AAAA1111", body: {} }]);
    // Removal isn't a redemption: the claim stays unredeemed.
    expect(statusOf(id)).toBe("unredeemed");
  });

  it("keeps a code on its claimer's cart", async () => {
    const { enforcement, seed } = await loadModules();

    await seed("store1", 42, "HUNT-AAAA1111");

    const { client, deletes } = fakeClient([checkout(42, ["HUNT-AAAA1111"])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client)).toEqual({ removed: [] });
    expect(deletes).toEqual([]);
  });

  it("ignores another store's claims and non-claim codes", async () => {
    const { enforcement, seed } = await loadModules();

    await seed("store2", 42, "HUNT-AAAA1111");

    const { client, deletes } = fakeClient([checkout(99, ["HUNT-AAAA1111", "SUMMER10"])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client)).toEqual({ removed: [] });
    expect(deletes).toEqual([]);
  });

  it("does nothing for a cart with no coupons", async () => {
    const { enforcement } = await loadModules();
    const { client, deletes } = fakeClient([checkout(99, [])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client)).toEqual({ removed: [] });
    expect(deletes).toEqual([]);
  });

  it("leaves a guest cart alone by default, without waiting", async () => {
    const { enforcement, seed } = await loadModules();
    const sleep = vi.fn(async () => {});

    await seed("store1", 42, "HUNT-AAAA1111");

    const { client, deletes, reads } = fakeClient([checkout(0, ["HUNT-AAAA1111"])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client, sleep)).toEqual({ removed: [] });
    expect(deletes).toEqual([]);
    expect(reads).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("with guest removal on, re-reads a guest cart after a pause and spares a login that has since landed", async () => {
    process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS = "true";

    const { enforcement, seed } = await loadModules();
    const sleep = vi.fn(async () => {});

    await seed("store1", 42, "HUNT-AAAA1111");

    // First read: not yet associated (0); second read: the claimer is now on the cart.
    const { client, deletes, reads } = fakeClient([checkout(0, ["HUNT-AAAA1111"]), checkout(42, ["HUNT-AAAA1111"])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client, sleep)).toEqual({ removed: [] });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(reads).toHaveLength(2);
    expect(deletes).toEqual([]);
  });

  it("with guest removal on, removes a claim code from a cart that is still a guest after the re-read", async () => {
    process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS = "true";

    const { enforcement, seed } = await loadModules();

    await seed("store1", 42, "HUNT-AAAA1111");

    const { client, deletes } = fakeClient([checkout(0, ["HUNT-AAAA1111"])]);

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client, async () => {})).toEqual({
      removed: ["HUNT-AAAA1111"],
    });
    expect(deletes).toHaveLength(1);
  });

  it("tolerates a code that is already gone and keeps going after another delete fails", async () => {
    const { enforcement, seed } = await loadModules();
    // Imported after resetModules so AppError is the same class the enforcer's
    // `instanceof` check sees.
    const { logError } = await import("@/lib/errors/logger");
    const { AppError } = await import("@/lib/errors/app-error");

    await seed("store1", 41, "HUNT-AAAA1111");
    await seed("store1", 42, "HUNT-BBBB2222");
    await seed("store1", 43, "HUNT-CCCC3333");

    const { client, deletes } = fakeClient([checkout(99, ["HUNT-AAAA1111", "HUNT-BBBB2222", "HUNT-CCCC3333"])], {
      deleteError: (code) =>
        code === "HUNT-AAAA1111"
          ? new AppError("UPSTREAM_API", "gone", { status: 404 })
          : code === "HUNT-BBBB2222"
            ? new AppError("UPSTREAM_API", "forbidden", { status: 403 })
            : undefined,
    });

    expect(await enforcement.enforceCartCoupons("store1", "cart-1", client)).toEqual({ removed: ["HUNT-CCCC3333"] });
    expect(deletes).toHaveLength(3);
    // Only the 403 is worth logging; a 404 means someone else already removed it.
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(1);
  });

  it("URL-encodes the cart id and the code", async () => {
    const { enforcement, seed } = await loadModules();

    await seed("store1", 42, "HUNT-A/B 1");

    const { client, deletes } = fakeClient([checkout(99, ["HUNT-A/B 1"])]);

    await enforcement.enforceCartCoupons("store1", "cart/1", client);

    expect(deletes[0].path).toBe("/v3/checkouts/cart%2F1/coupons/HUNT-A%2FB%201");
  });

  it("throws, removing nothing, when the checkout has no numeric customer id", async () => {
    const { enforcement, seed } = await loadModules();

    await seed("store1", 42, "HUNT-AAAA1111");

    const { client, deletes } = fakeClient([{ data: { coupons: [{ code: "HUNT-AAAA1111" }] } }]);

    await expect(enforcement.enforceCartCoupons("store1", "cart-1", client)).rejects.toThrow(/customer_id/);
    expect(deletes).toEqual([]);
  });
});
