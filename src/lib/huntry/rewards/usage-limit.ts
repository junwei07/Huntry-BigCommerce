import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { PlacedEggClaimCapacity } from "@/lib/huntry/eggs/types";
import { HuntryReward } from "@/lib/huntry/rewards/types";

// A reward's redemption budget = how many eggs it may have (egg_capacity) x
// how many different players can claim each one (the event's claim
// capacity), independent of how many eggs are placed yet. Deliberately NOT
// a port of huntry_calculate_reward_usage_limit() (huntry/includes/rewards/
// coupon-sync.php:76), which sums the claim capacity of each *placed* egg
// and so only reaches eggs x claims once every egg is placed — a user-
// directed departure so the coupon is sized for the reward's full capacity
// from the start. A reward whose eggs span events uses the highest claim
// capacity among them; with none placed (or no parent event) it counts as 1.
// egg_capacity <= 0 keeps the MAX_EGGS_PER_REWARD fallback. Parameterized so
// recomputeRewardUsageLimit (BC-HUN-028) can pass real placed-egg data.
export function computeRewardUsageLimit(
  reward: Pick<HuntryReward, "eggCapacity">,
  placedEggs: PlacedEggClaimCapacity[],
): number {
  const eggs = reward.eggCapacity > 0 ? reward.eggCapacity : MAX_EGGS_PER_REWARD;
  const claimCapacity = Math.max(1, ...placedEggs.map((egg) => egg.eventClaimCapacity ?? 1));

  return eggs * claimCapacity;
}
