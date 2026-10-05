import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import {
  buildPromotionRequestBody,
  computeRewardUsageLimit,
  recomputeRewardsUsageLimits,
  recomputeRewardUsageLimit,
  syncRewardCoupon,
  withUsageLimitWarning,
} from "@/lib/huntry/rewards/coupon-sync";
import { HuntryReward } from "@/lib/huntry/rewards/types";

// The recompute tests below only care about the PUT body and orchestration,
// not the DB or a real REST client — stub the three collaborators.
const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  fetchPlacedEggCapacitiesUncached: vi.fn(),
  fetchRewardUncached: vi.fn(),
}));

vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({
  getRestApiClient: vi.fn(async () => ({ put: mocks.put })),
}));

vi.mock("@/lib/huntry/eggs/eggs-api", () => ({
  fetchPlacedEggCapacitiesUncached: mocks.fetchPlacedEggCapacitiesUncached,
}));

vi.mock("@/lib/huntry/rewards/rewards-api", () => ({
  fetchRewardUncached: mocks.fetchRewardUncached,
}));

// limit = the reward's egg count x the event's item claim count (see
// computeRewardUsageLimit's comment — deliberately not the plugin's
// sum-over-placed-eggs). No BigCommerce/DB dependency.
describe("computeRewardUsageLimit", () => {
  it("is the reward's egg_capacity x 1 when no eggs are placed", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 7 }, [])).toBe(7);
  });

  it("falls back to MAX_EGGS_PER_REWARD when egg_capacity is zero", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 0 }, [])).toBe(MAX_EGGS_PER_REWARD);
  });

  it("multiplies egg_capacity by the event's claim capacity", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 5 }, [{ eventClaimCapacity: 3 }])).toBe(15);
  });

  it("does not grow with the number of eggs placed in the same event", () => {
    const placedEggs = [{ eventClaimCapacity: 3 }, { eventClaimCapacity: 3 }, { eventClaimCapacity: 3 }];

    expect(computeRewardUsageLimit({ eggCapacity: 5 }, placedEggs)).toBe(15);
  });

  it("uses the highest claim capacity when eggs span several events", () => {
    const placedEggs = [{ eventClaimCapacity: 3 }, { eventClaimCapacity: 5 }];

    expect(computeRewardUsageLimit({ eggCapacity: 2 }, placedEggs)).toBe(10);
  });

  it("counts a placed egg with no parent event as a claim capacity of 1", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 4 }, [{ eventClaimCapacity: null }])).toBe(4);
  });
});

const BASE_REWARD: HuntryReward = {
  id: 1,
  storeHash: "test-store",
  name: "Test Reward",
  description: "",
  sponsorId: null,
  eggCapacity: 1,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
  couponCode: "TESTCODE",
  bcPromotionId: null,
  bcCouponCodeId: null,
  bcCustomerGroupId: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// BC-HUN-021: group-scoped eligibility is a top-level `customer` field on
// the Promotion resource (confirmed live, docs/MIGRATION.md §8), present
// only once a Customer Group has actually been synced.
describe("buildPromotionRequestBody", () => {
  it("omits customer when bcCustomerGroupId is null", () => {
    const body = buildPromotionRequestBody(BASE_REWARD);

    expect(body).not.toHaveProperty("customer");
  });

  it("includes customer.group_ids as a number when bcCustomerGroupId is set", () => {
    const body = buildPromotionRequestBody({ ...BASE_REWARD, bcCustomerGroupId: "42" });

    expect(body).toMatchObject({ customer: { group_ids: [42] } });
  });
});

// BC-HUN-022: syncRewardCoupon short-circuits entirely in MOCK mode (never
// calls getRestApiClient) — confirmed by reading coupon-sync.ts directly,
// not by building unused Promotions/Customer-Group mock handlers that
// nothing would ever exercise (MockRestApiClient only supports GET; this
// path is a write).
describe("syncRewardCoupon (MOCK mode)", () => {
  const originalDataMode = process.env.DATA_MODE;

  afterEach(() => {
    if (originalDataMode === undefined) {
      delete process.env.DATA_MODE;
    } else {
      process.env.DATA_MODE = originalDataMode;
    }
  });

  it("returns deterministic placeholder ids when none exist yet", async () => {
    process.env.DATA_MODE = "MOCK";

    await expect(syncRewardCoupon(BASE_REWARD, "test-store")).resolves.toEqual({
      bcPromotionId: "mock-promotion-1",
      bcCouponCodeId: "mock-coupon-1",
      bcCustomerGroupId: "mock-customer-group-1",
    });
  });

  it("preserves already-set bc*Id fields instead of overwriting them", async () => {
    process.env.DATA_MODE = "MOCK";

    const reward = { ...BASE_REWARD, bcPromotionId: "real-promo", bcCouponCodeId: "real-coupon", bcCustomerGroupId: "real-group" };

    await expect(syncRewardCoupon(reward, "test-store")).resolves.toEqual({
      bcPromotionId: "real-promo",
      bcCouponCodeId: "real-coupon",
      bcCustomerGroupId: "real-group",
    });
  });
});

const SYNCED_REWARD: HuntryReward = {
  ...BASE_REWARD,
  bcPromotionId: "promo-9",
  bcCouponCodeId: "code-9",
};

// BC-HUN-028
describe("buildPromotionRequestBody max_uses", () => {
  it("omits max_uses unless a limit is passed", () => {
    expect(buildPromotionRequestBody(BASE_REWARD)).not.toHaveProperty("max_uses");
  });

  it("puts the redemption budget on the promotion itself", () => {
    expect(buildPromotionRequestBody(BASE_REWARD, 12)).toMatchObject({ max_uses: 12 });
  });
});

describe("recomputeRewardUsageLimit", () => {
  const originalDataMode = process.env.DATA_MODE;

  beforeEach(() => {
    process.env.DATA_MODE = "MULTITENANT";
    mocks.put.mockReset().mockResolvedValue({ data: {} });
    mocks.fetchPlacedEggCapacitiesUncached.mockReset().mockResolvedValue([]);
    mocks.fetchRewardUncached.mockReset();
  });

  afterEach(() => {
    if (originalDataMode === undefined) {
      delete process.env.DATA_MODE;
    } else {
      process.env.DATA_MODE = originalDataMode;
    }
  });

  // BigCommerce has no PUT for an existing coupon code, and the promotion's
  // max_uses overrides the code's — so the limit goes on the promotion.
  it("PUTs egg_capacity x the highest event claim capacity as the promotion's max_uses", async () => {
    mocks.fetchPlacedEggCapacitiesUncached.mockResolvedValue([
      { eventClaimCapacity: 3 },
      { eventClaimCapacity: 2 },
      { eventClaimCapacity: null },
    ]);

    await recomputeRewardUsageLimit({ ...SYNCED_REWARD, eggCapacity: 2, bcCustomerGroupId: "42" }, "test-store");

    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledWith("/v3/promotions/promo-9", {
      body: expect.objectContaining({ max_uses: 6, redemption_type: "COUPON", customer: { group_ids: [42] } }),
    });
  });

  it("never calls the coupon-code endpoint", async () => {
    await recomputeRewardUsageLimit(SYNCED_REWARD, "test-store");

    expect(mocks.put.mock.calls.every(([url]) => !String(url).includes("/codes"))).toBe(true);
  });

  it("falls back to the reward's egg_capacity when no eggs are placed", async () => {
    await recomputeRewardUsageLimit({ ...SYNCED_REWARD, eggCapacity: 7 }, "test-store");

    expect(mocks.put).toHaveBeenCalledWith(expect.any(String), { body: expect.objectContaining({ max_uses: 7 }) });
  });

  it("does nothing for a reward that was never synced to BigCommerce", async () => {
    await recomputeRewardUsageLimit(BASE_REWARD, "test-store");

    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("does nothing in MOCK mode", async () => {
    process.env.DATA_MODE = "MOCK";

    await recomputeRewardUsageLimit(SYNCED_REWARD, "test-store");

    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure", async () => {
    mocks.put.mockRejectedValue(new Error("boom"));

    await expect(recomputeRewardUsageLimit(SYNCED_REWARD, "test-store")).rejects.toThrow("boom");
  });
});

describe("recomputeRewardsUsageLimits", () => {
  const originalDataMode = process.env.DATA_MODE;

  beforeEach(() => {
    process.env.DATA_MODE = "MULTITENANT";
    mocks.put.mockReset().mockResolvedValue({ data: {} });
    mocks.fetchPlacedEggCapacitiesUncached.mockReset().mockResolvedValue([]);
    mocks.fetchRewardUncached
      .mockReset()
      .mockImplementation(async (id: number) => ({ ...SYNCED_REWARD, id, bcPromotionId: `promo-${id}` }));
  });

  afterEach(() => {
    if (originalDataMode === undefined) {
      delete process.env.DATA_MODE;
    } else {
      process.env.DATA_MODE = originalDataMode;
    }
  });

  it("recomputes each distinct reward id once", async () => {
    const result = await recomputeRewardsUsageLimits([1, 2, 2, 1, 3], "test-store");

    expect(result).toEqual({ updated: 3, failed: [] });
    expect(mocks.put).toHaveBeenCalledTimes(3);
  });

  it("isolates a failing reward from the rest", async () => {
    mocks.put.mockImplementation(async (url: string) => {
      if (url.endsWith("/promotions/promo-2")) {
        throw new Error("rate limited");
      }

      return { data: {} };
    });

    const result = await recomputeRewardsUsageLimits([1, 2, 3, 4, 5, 6], "test-store");

    expect(result.updated).toBe(5);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].rewardId).toBe(2);
  });

  it("never runs more than a handful of recomputes at once", async () => {
    let inFlight = 0;
    let peak = 0;

    mocks.put.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return { data: {} };
    });

    await recomputeRewardsUsageLimits(Array.from({ length: 20 }, (_, index) => index + 1), "test-store");

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("handles an empty list without calling anything", async () => {
    await expect(recomputeRewardsUsageLimits([], "test-store")).resolves.toEqual({ updated: 0, failed: [] });
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe("withUsageLimitWarning", () => {
  it("returns the message untouched when nothing failed", () => {
    expect(withUsageLimitWarning("Egg deleted.", { updated: 1, failed: [] })).toBe("Egg deleted.");
  });

  it("appends the failed reward ids", () => {
    const message = withUsageLimitWarning("Egg deleted.", {
      updated: 0,
      failed: [
        { rewardId: 4, message: "x" },
        { rewardId: 9, message: "y" },
      ],
    });

    expect(message).toContain("Egg deleted.");
    expect(message).toContain("2 rewards (#4, #9)");
  });
});
