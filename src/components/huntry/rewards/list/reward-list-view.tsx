import { Box, Flex, InlineMessage, Panel, Text } from "@bigcommerce/big-design";
import { RewardCard } from "@/components/huntry/rewards/list/reward-card";
import { RewardListHeader } from "@/components/huntry/rewards/list/reward-list-header";
import { NewRewardButton } from "@/components/huntry/rewards/list/new-reward-button";
import { SortSelect } from "@/components/huntry/rewards/list/sort-select";
import { fetchRewards } from "@/lib/huntry/rewards/rewards-api";
import { MAX_REWARDS } from "@/lib/huntry/rewards/limits";
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

  // The rewards list is unfiltered (search params only affect sort order), so
  // its length is the true count.
  const limitReached = rewards.length >= MAX_REWARDS;

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Rewards" style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        {limitReached ? (
          <Box marginBottom="medium">
            <InlineMessage
              header="Reward limit reached"
              messages={[{ text: `You have reached your limit of ${MAX_REWARDS} rewards.` }]}
              type="info"
            />
          </Box>
        ) : null}

        <Flex alignItems="center" justifyContent="space-between" marginBottom="medium">
          <SortSelect query={query} />
          <NewRewardButton limitReached={limitReached} />
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
