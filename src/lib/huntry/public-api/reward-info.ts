import { logError } from "@/lib/errors/logger";
import { fetchBcProductLinks, fetchRewardUncached } from "@/lib/huntry/rewards/rewards-api";
import { formatRewardHeadline, isRewardWindowOpen } from "@/lib/huntry/rewards/reward-display";

export interface RewardInfo {
  expired: boolean;
  headline: string | null;
  products: { name: string; url: string }[];
}

// The reward is gone (hard delete, no FK from claims) or no longer open.
export const EXPIRED_INFO: RewardInfo = { expired: true, headline: null, products: [] };
// The lookup itself failed: say nothing rather than wrongly showing "Expired".
export const UNKNOWN_INFO: RewardInfo = { expired: false, headline: null, products: [] };

// Live per-reward display state, like the plugin's coupon-post lookup
// (my-account.php L98-106): claims snapshot only the reward name, so `expired`,
// the headline and the product scope come from the reward as it is now. A
// failed lookup for one reward leaves that card without the extras (and not
// marked expired) rather than failing the whole list.
export async function loadRewardInfo(storeHash: string, rewardIds: number[]): Promise<Map<number, RewardInfo>> {
  const entries = await Promise.all(
    rewardIds.map(async (rewardId): Promise<[number, RewardInfo] | null> => {
      try {
        const reward = await fetchRewardUncached(rewardId, storeHash);

        if (!reward || !isRewardWindowOpen({ status: reward.status, startsAt: reward.rewardStartsAt, expiresAt: reward.rewardExpiresAt })) {
          return [rewardId, EXPIRED_INFO];
        }

        return [
          rewardId,
          {
            expired: false,
            headline: formatRewardHeadline(reward.discountType, reward.discountValue),
            products: reward.discountScope === "specific" ? await fetchBcProductLinks(storeHash, reward.productIds) : [],
          },
        ];
      } catch (error) {
        logError(`rewards: store "${storeHash}" reward ${rewardId}`, error);

        return null;
      }
    }),
  );

  return new Map(entries.filter((entry): entry is [number, RewardInfo] => entry !== null));
}
