import { describe, expect, it } from "vitest";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { buildPromotionRequestBody, computeRewardUsageLimit } from "@/lib/huntry/rewards/coupon-sync";
import { HuntryReward } from "@/lib/huntry/rewards/types";

// Pure port of huntry_calculate_reward_usage_limit() (coupon-sync.php) — no
// BigCommerce/DB dependency, so this is worth pinning down now even though
// BC-HUN-020 only ever calls it with an empty placedEggs array (no
// huntry_eggs query exists yet). BC-HUN-028 reuses this same function once
// real placed-egg data exists.
describe("computeRewardUsageLimit", () => {
  it("falls back to the reward's own egg_capacity when no eggs are placed", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 7 }, [])).toBe(7);
  });

  it("falls back to MAX_EGGS_PER_REWARD when egg_capacity is zero and no eggs are placed", () => {
    expect(computeRewardUsageLimit({ eggCapacity: 0 }, [])).toBe(MAX_EGGS_PER_REWARD);
  });

  it("sums each placed egg's parent event claim capacity", () => {
    const placedEggs = [{ eventClaimCapacity: 3 }, { eventClaimCapacity: 5 }];

    expect(computeRewardUsageLimit({ eggCapacity: 1 }, placedEggs)).toBe(8);
  });

  it("counts a placed egg with no parent event as 1", () => {
    const placedEggs = [{ eventClaimCapacity: 3 }, { eventClaimCapacity: null }];

    expect(computeRewardUsageLimit({ eggCapacity: 1 }, placedEggs)).toBe(4);
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
