import { Box, Flex, Panel, Text } from "@bigcommerce/big-design";
import { RewardCard } from "@/components/huntry/rewards/list/reward-card";
import { RewardListHeader } from "@/components/huntry/rewards/list/reward-list-header";
import { NewRewardButton } from "@/components/huntry/rewards/list/new-reward-button";
import { SortToggle } from "@/components/huntry/rewards/list/sort-toggle";
import { fetchRewards } from "@/lib/huntry/rewards/rewards-api";
import { parseRewardsQuery } from "@/lib/huntry/rewards/query";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
// @cache-components-only:end

export async function RewardListView({
  searchParams,
  storeHash,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  storeHash: string | undefined;
}) {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(REWARDS_LIST_TAG);
  // @cache-components-only:end

  const query = parseRewardsQuery(searchParams);
  const rewards = await fetchRewards(query, storeHash);
  // HuntryReward only stores sponsorId, never a denormalized sponsor
  // name/logo — resolved once here rather than each card doing its own
  // per-row fetch.
  const sponsors = await fetchSponsors({ direction: "ASC" }, storeHash);
  const sponsorById = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));

  // @cache-components-only:start
  for (const reward of rewards) {
    cacheTag(rewardTag(reward.id));
  }
  // @cache-components-only:end

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Rewards" style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        <Flex alignItems="center" justifyContent="space-between" marginBottom="medium">
          <SortToggle query={query} />
          <NewRewardButton />
        </Flex>

        <RewardListHeader />

        {rewards.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No rewards yet.</Text>
        ) : (
          <Flex flexDirection="column" flexGap="0.75rem" marginTop="small">
            {rewards.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                sponsor={reward.sponsorId ? (sponsorById.get(reward.sponsorId) ?? null) : null}
              />
            ))}
          </Flex>
        )}
      </Panel>
    </Box>
  );
}
