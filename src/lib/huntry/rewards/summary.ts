interface SummaryReward {
  id: number;
  eggCapacity: number;
}

interface SummaryEgg {
  rewardId: number;
}

// Port of huntry_render_reward_summary (huntry/includes/rewards/cpt.php): the
// Rewards list's four cards. `eggCountsByReward` is store-wide (every event).
export function summarizeRewards(rewards: SummaryReward[], eggCountsByReward: Map<number, number>) {
  const totalCapacity = rewards.reduce((sum, reward) => sum + reward.eggCapacity, 0);
  const placed = rewards.reduce((sum, reward) => sum + (eggCountsByReward.get(reward.id) ?? 0), 0);

  return { totalRewards: rewards.length, totalCapacity, placed, remaining: Math.max(0, totalCapacity - placed) };
}

// The Overview's Items Placed / Rewards cards for one event
// (huntry_render_overview_page). A reward's whole capacity counts once if it has
// any egg in the event, as in WP. WP's `count($rewards)` actually counts every
// reward despite its comment; this counts only rewards placed in the event.
export function summarizeEventRewards(rewards: SummaryReward[], eventEggs: SummaryEgg[]) {
  const placedByReward = new Map<number, number>();

  for (const egg of eventEggs) {
    placedByReward.set(egg.rewardId, (placedByReward.get(egg.rewardId) ?? 0) + 1);
  }

  let totalPlaced = 0;
  let totalCapacity = 0;
  let rewardCount = 0;

  for (const reward of rewards) {
    const placed = placedByReward.get(reward.id) ?? 0;

    if (placed === 0) {
      continue;
    }

    rewardCount += 1;
    totalPlaced += placed;
    totalCapacity += reward.eggCapacity;
  }

  return { totalPlaced, totalCapacity, rewardCount };
}
