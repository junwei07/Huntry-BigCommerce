import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { CreateRewardInput } from "@/lib/huntry/rewards/types";

// Same two Next.js request-context mocks as
// tests/lib/session/is-authorized-for-store.test.ts.
vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

// updateTag (called on every update/delete path, success or
// partial-failure) throws outside a real Server Action request context,
// same class of problem as connection()/cookies() above.
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (nameOrOptions: string | { name: string }) => {
      cookieJar.delete(typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name);
    },
  })),
}));

// See actions.test.ts's identical comment — these tests are about
// updateHuntryReward/deleteHuntryReward's own orchestration, not
// syncRewardCoupon itself (coupon-sync.test.ts covers that directly), and
// stubbing it avoids any real BigCommerce network call.
vi.mock("@/lib/huntry/rewards/coupon-sync", () => ({
  syncRewardCoupon: vi.fn().mockResolvedValue({
    bcPromotionId: "promo-1",
    bcCouponCodeId: "coupon-1",
    bcCustomerGroupId: "group-1",
  }),
}));

let tempDir: string;

const USER_ID = 1;
const LINKED_STORE_HASH = "store-a";
const UNLINKED_STORE_HASH = "store-b";

beforeEach(() => {
  cookieJar.clear();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-rewards-id-actions-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  process.env.DATA_MODE = "MULTITENANT";
});

afterEach(() => {
  vi.resetModules();

  // Best-effort — see tests/lib/session/is-authorized-for-store.test.ts's
  // afterEach (DatabaseSync/SqliteCredentialsStore keep their file handles
  // open, which can lock the temp dir on Windows).
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

async function seedLinkedStore(storeHash: string) {
  const { SqliteCredentialsStore } = await import("@/lib/credentials-store/sqlite-driver/sqlite-credentials-store");
  const store = new SqliteCredentialsStore();

  await store.setUser({ userId: USER_ID, email: "admin@example.com" });
  await store.setStore({ storeHash, accessToken: "token", scope: "x", adminUserId: USER_ID });
  await store.setStoreUser({ storeHash, userId: USER_ID });
}

async function signCookieFor(authenticatedStores: string[]) {
  const { signSession } = await import("@/lib/session/session-jwt");
  const { SESSION_COOKIE_NAME } = await import("@/lib/session/types");
  const jwt = await signSession({ userId: USER_ID, authenticatedStores, issuedAt: Math.floor(Date.now() / 1000) });

  cookieJar.set(SESSION_COOKIE_NAME, jwt);
}

const BASE_CREATE_INPUT: CreateRewardInput = {
  name: "Existing Reward",
  description: "desc",
  sponsorId: null,
  couponCode: "EXISTING",
  eggCapacity: 5,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
};

const VALID_UPDATE_INPUT: RewardFormInput = {
  name: "Updated Reward",
  description: "updated desc",
  sponsorId: "",
  couponCode: "EXISTING",
  rewardStartsAt: "2026-01-01",
  rewardExpiresAt: "2026-02-01",
  eggCapacity: "5",
  discountType: "percent",
  discountValue: "15",
  discountScope: "all",
  productIds: [],
};

describe("updateHuntryReward", () => {
  it("rejects an unauthorized store without writing", async () => {
    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const { updateHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");

    const result = await updateHuntryReward(existing.id, VALID_UPDATE_INPUT, LINKED_STORE_HASH);

    expect(result).toEqual({ success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE });

    const unchanged = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(unchanged?.name).toBe("Existing Reward");
  });

  it("reports not-found when updating another store's reward (store isolation)", async () => {
    const { createReward } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    // A legitimately authorized caller — just for a *different* store, not
    // an auth failure. isAuthorizedForStore(UNLINKED_STORE_HASH) is true
    // here; the DAL's own store_hash scoping is what must still prevent the
    // cross-store write.
    await seedLinkedStore(UNLINKED_STORE_HASH);
    await signCookieFor([UNLINKED_STORE_HASH]);

    const { updateHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await updateHuntryReward(existing.id, VALID_UPDATE_INPUT, UNLINKED_STORE_HASH);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no longer exists");
  });

  it("rejects a coupon code collision with another reward in the same store", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createReward } = await import("@/lib/huntry/rewards/rewards-api");
    await createReward({ ...BASE_CREATE_INPUT, couponCode: "OTHERCODE" }, LINKED_STORE_HASH);
    const target = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const { updateHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await updateHuntryReward(
      target.id,
      { ...VALID_UPDATE_INPUT, couponCode: "OTHERCODE" },
      LINKED_STORE_HASH,
    );

    expect(result).toEqual({ success: false, message: "That coupon code is already used by another reward." });
  });

  it("allows a reward to keep its own current coupon code on update", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const { updateHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await updateHuntryReward(existing.id, VALID_UPDATE_INPUT, LINKED_STORE_HASH);

    expect(result).toEqual({ success: true, message: 'Reward "Updated Reward" updated.' });

    const updated = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(updated?.discountValue).toBe(15);
    expect(updated?.bcPromotionId).toBe("promo-1");
  });

  it("keeps the updated reward row when coupon sync fails, and reports the partial failure", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const couponSync = await import("@/lib/huntry/rewards/coupon-sync");

    vi.mocked(couponSync.syncRewardCoupon).mockRejectedValueOnce(new Error("boom"));

    const { updateHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await updateHuntryReward(existing.id, VALID_UPDATE_INPUT, LINKED_STORE_HASH);

    expect(result.success).toBe(false);
    expect(result.message).toContain("was updated, but syncing its BigCommerce coupon failed");

    const updated = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(updated?.name).toBe("Updated Reward");
    expect(updated?.bcPromotionId).toBeNull();
  });
});

// The "archiving" coverage BC-HUN-022 originally asked for doesn't apply —
// deleteHuntryReward is a genuine hard delete (see [id]/actions.ts's own
// comment); these tests cover that hard-delete behavior instead.
describe("deleteHuntryReward", () => {
  it("rejects an unauthorized store without deleting", async () => {
    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const { deleteHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");

    const result = await deleteHuntryReward(existing.id, LINKED_STORE_HASH);

    expect(result).toEqual({ success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE });

    const stillThere = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(stillThere).toBeDefined();
  });

  it("reports not-found rather than deleting another store's reward (store isolation)", async () => {
    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    await seedLinkedStore(UNLINKED_STORE_HASH);
    await signCookieFor([UNLINKED_STORE_HASH]);

    const { deleteHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await deleteHuntryReward(existing.id, UNLINKED_STORE_HASH);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no longer exists");

    const stillThere = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(stillThere).toBeDefined();
  });

  it("reports not-found for an already-deleted/nonexistent id", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { deleteHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await deleteHuntryReward(999999, LINKED_STORE_HASH);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no longer exists");
  });

  it("hard-deletes the reward row for an authorized store", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createReward, fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");
    const existing = await createReward(BASE_CREATE_INPUT, LINKED_STORE_HASH);

    const { deleteHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/[id]/actions");

    const result = await deleteHuntryReward(existing.id, LINKED_STORE_HASH);

    expect(result).toEqual({ success: true, message: "Reward deleted." });

    const gone = await fetchRewardUncached(existing.id, LINKED_STORE_HASH);

    expect(gone).toBeUndefined();
  });
});
