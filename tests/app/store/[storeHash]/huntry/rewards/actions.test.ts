import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";

// Same two Next.js request-context mocks as
// tests/lib/session/is-authorized-for-store.test.ts — see that file's own
// comment for why only these two are mocked; everything else (JWT signing,
// the real SQLite credentials store, the real SQLite rewards DB) runs for
// real.
vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

// updateTag (called on every create/update/delete path, success or
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

// These tests are about createHuntryReward's own orchestration (the auth
// gate, validation, the coupon-code uniqueness pre-check, and
// partial-failure handling) — not about syncRewardCoupon itself, which
// coupon-sync.test.ts already covers directly (including its MOCK-mode
// short-circuit). Stubbing it out here also means these tests never attempt
// a real BigCommerce network call.
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
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-rewards-actions-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  process.env.DATA_MODE = "MULTITENANT";
});

afterEach(() => {
  vi.resetModules();

  // SqliteCredentialsStore/DatabaseSync keep their file handles open for the
  // process lifetime — see tests/lib/session/is-authorized-for-store.test.ts's
  // afterEach. Best-effort cleanup; a leftover temp dir is harmless, unlike
  // failing the suite over it on Windows.
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored — see comment above.
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

const VALID_INPUT: RewardFormInput = {
  name: "Test Reward",
  description: "A test reward",
  sponsorId: "",
  couponCode: "TESTCODE",
  rewardStartsAt: "2026-01-01",
  rewardExpiresAt: "2026-02-01",
  eggCapacity: "5",
  discountType: "percent",
  discountValue: "10",
  discountScope: "all",
  productIds: [],
};

describe("createHuntryReward", () => {
  it("rejects a store with no session at all", async () => {
    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");
    const { isRewardCouponCodeTaken } = await import("@/lib/huntry/rewards/rewards-api");

    const result = await createHuntryReward(VALID_INPUT, LINKED_STORE_HASH);

    expect(result).toEqual({ success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE });
    await expect(isRewardCouponCodeTaken(LINKED_STORE_HASH, VALID_INPUT.couponCode)).resolves.toBe(false);
  });

  it("rejects a store the session never claimed (store isolation)", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");
    const { isRewardCouponCodeTaken } = await import("@/lib/huntry/rewards/rewards-api");

    const result = await createHuntryReward(VALID_INPUT, UNLINKED_STORE_HASH);

    expect(result).toEqual({ success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE });
    await expect(isRewardCouponCodeTaken(UNLINKED_STORE_HASH, VALID_INPUT.couponCode)).resolves.toBe(false);
  });

  it("rejects invalid input without writing a row", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");
    const { isRewardCouponCodeTaken } = await import("@/lib/huntry/rewards/rewards-api");

    const result = await createHuntryReward({ ...VALID_INPUT, name: "" }, LINKED_STORE_HASH);

    expect(result).toEqual({ success: false, message: "Name is required." });
    await expect(isRewardCouponCodeTaken(LINKED_STORE_HASH, VALID_INPUT.couponCode)).resolves.toBe(false);
  });

  it("rejects a coupon code already used by another reward in the same store", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");

    const first = await createHuntryReward(VALID_INPUT, LINKED_STORE_HASH);

    expect(first.success).toBe(true);

    const second = await createHuntryReward({ ...VALID_INPUT, name: "Another Reward" }, LINKED_STORE_HASH);

    expect(second).toEqual({ success: false, message: "That coupon code is already used by another reward." });
  });

  it("creates the reward and syncs its coupon fields on success", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");
    const { fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");

    const result = await createHuntryReward(VALID_INPUT, LINKED_STORE_HASH);

    expect(result).toEqual({ success: true, message: 'Reward "Test Reward" created.' });

    // A fresh per-test SQLite DB, so this is the first row ever inserted.
    const reward = await fetchRewardUncached(1, LINKED_STORE_HASH);

    expect(reward?.bcPromotionId).toBe("promo-1");
    expect(reward?.bcCouponCodeId).toBe("coupon-1");
    expect(reward?.bcCustomerGroupId).toBe("group-1");
  });

  it("keeps the reward row when coupon sync fails, and reports the partial failure", async () => {
    await seedLinkedStore(LINKED_STORE_HASH);
    await signCookieFor([LINKED_STORE_HASH]);

    const couponSync = await import("@/lib/huntry/rewards/coupon-sync");

    vi.mocked(couponSync.syncRewardCoupon).mockRejectedValueOnce(new Error("boom"));

    const { createHuntryReward } = await import("@/app/store/[storeHash]/huntry/rewards/actions");
    const { fetchRewardUncached } = await import("@/lib/huntry/rewards/rewards-api");

    const result = await createHuntryReward(VALID_INPUT, LINKED_STORE_HASH);

    expect(result.success).toBe(false);
    expect(result.message).toContain("was created, but creating its BigCommerce coupon failed");

    const reward = await fetchRewardUncached(1, LINKED_STORE_HASH);

    expect(reward?.name).toBe("Test Reward");
    expect(reward?.bcPromotionId).toBeNull();
  });
});

describe("searchRewardProducts", () => {
  it("returns an empty array rather than throwing when not authorized", async () => {
    const { searchRewardProducts } = await import("@/app/store/[storeHash]/huntry/rewards/actions");

    await expect(searchRewardProducts("widget", LINKED_STORE_HASH)).resolves.toEqual([]);
  });
});
