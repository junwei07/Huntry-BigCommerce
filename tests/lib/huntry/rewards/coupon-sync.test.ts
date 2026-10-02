import { describe, expect, it } from "vitest";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { computeRewardUsageLimit } from "@/lib/huntry/rewards/coupon-sync";

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
