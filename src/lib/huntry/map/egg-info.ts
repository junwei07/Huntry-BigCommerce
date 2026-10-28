import type { EggClaimCount } from "@/lib/huntry/claims/types";
import type { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import type { HuntryReward } from "@/lib/huntry/rewards/types";

// What the egg hover popup reads, gathered by the map view at hover time.
export interface EggInfoContext {
  rewards: HuntryReward[];
  // reward id -> eggs it has across every event.
  rewardEggCounts: Record<number, number>;
  sponsorNames: Record<number, string>;
  // Placements queued this session and not saved yet.
  pending: PendingEgg[];
  claimCapacity: number;
  // egg id -> claims on it; eggs with no claims are absent.
  claimCounts: Record<string, EggClaimCount>;
}

// Port of the plugin's openEggInfoPopup text: reward, sponsor, eggs placed
// (saved plus queued, against the reward's capacity), claims and coordinates.
export function buildEggInfoLines(egg: HuntryEgg, context: EggInfoContext): { title: string; lines: string[] } {
  const reward = context.rewards.find((item) => item.id === egg.rewardId);
  const queued = context.pending.filter((item) => item.rewardId === egg.rewardId).length;
  const sponsor = reward?.sponsorId == null ? null : (context.sponsorNames[reward.sponsorId] ?? null);
  const lines = [
    `Reward: ${reward?.name ?? "Unknown reward"}`,
    `Sponsor: ${sponsor ?? "-"}`,
    ...(reward ? [`Eggs Placed: ${(context.rewardEggCounts[reward.id] ?? 0) + queued}/${reward.eggCapacity}`] : []),
    `Claims: ${context.claimCounts[egg.id]?.count ?? 0}/${context.claimCapacity}`,
    `Lat: ${egg.lat.toFixed(6)}, Lng: ${egg.lng.toFixed(6)}`,
  ];

  return { title: egg.name || reward?.name || "Unnamed egg", lines };
}
