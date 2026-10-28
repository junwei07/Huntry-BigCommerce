import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import type { PendingEgg } from "@/lib/huntry/eggs/types";
import type { HuntryReward } from "@/lib/huntry/rewards/types";

export interface RewardChoice {
  reward: HuntryReward;
  sponsorName: string | null;
  remaining: number;
  // False when the reward has no room left (an edited egg's own reward stays
  // selectable — it already holds one of the slots).
  selectable: boolean;
}

// Reward cards for the Place/Edit dialog. "N left" counts the reward's eggs
// across every event plus this session's queued ones, against
// min(egg_capacity, MAX_EGGS_PER_REWARD); an edited egg's own reward stays
// selectable since it already holds a slot.
export function buildRewardChoices(
  rewards: HuntryReward[],
  rewardEggCounts: Record<number, number>,
  pending: PendingEgg[],
  sponsorNames: Record<number, string>,
  currentRewardId: number | null,
): RewardChoice[] {
  return rewards.map((reward) => {
    const used = (rewardEggCounts[reward.id] ?? 0) + pending.filter((egg) => egg.rewardId === reward.id).length;
    const remaining = Math.max(0, Math.min(reward.eggCapacity, MAX_EGGS_PER_REWARD) - used);

    return {
      reward,
      sponsorName: reward.sponsorId === null ? null : (sponsorNames[reward.sponsorId] ?? null),
      remaining,
      selectable: remaining > 0 || reward.id === currentRewardId,
    };
  });
}
