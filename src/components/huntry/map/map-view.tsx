import { Box, Panel, Text } from "@bigcommerce/big-design";
import { MapPlacementView } from "@/components/huntry/map/map-placement-view";
import { DEFAULT_QUERY } from "@/lib/huntry/events/query";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { fetchEggs, fetchRewardEggCounts } from "@/lib/huntry/eggs/eggs-api";
import { DEFAULT_QUERY as DEFAULT_REWARDS_QUERY } from "@/lib/huntry/rewards/query";
import { fetchRewards } from "@/lib/huntry/rewards/rewards-api";
import { DEFAULT_QUERY as DEFAULT_SPONSORS_QUERY } from "@/lib/huntry/sponsors/query";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";
import { parseSelectedEventId } from "@/lib/huntry/map/query";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { eggTag, EGGS_LIST_TAG, eventEggsTag } from "@/lib/huntry/eggs/cache-tags";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
// @cache-components-only:end

export async function MapView({
  searchParams,
  storeHash,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  storeHash: string | undefined;
}) {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EVENTS_LIST_TAG, REWARDS_LIST_TAG, EGGS_LIST_TAG, SPONSORS_LIST_TAG);
  // @cache-components-only:end

  const [events, rewards, sponsors, rewardEggCounts] = await Promise.all([
    fetchEvents(DEFAULT_QUERY, storeHash),
    fetchRewards(DEFAULT_REWARDS_QUERY, storeHash),
    fetchSponsors(DEFAULT_SPONSORS_QUERY, storeHash),
    fetchRewardEggCounts(storeHash),
  ]);

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }

  for (const reward of rewards) {
    cacheTag(rewardTag(reward.id));
  }

  for (const sponsor of sponsors) {
    cacheTag(sponsorTag(sponsor.id));
  }
  // @cache-components-only:end

  const requestedEventId = parseSelectedEventId(searchParams);
  const requestedEvent = events.find((event) => event.id === requestedEventId);
  const liveEvent = events.find((event) => event.status === "live");
  const selectedEventId = (requestedEvent ?? liveEvent ?? events[0])?.id ?? null;
  const eggs = selectedEventId === null ? [] : await fetchEggs(selectedEventId, storeHash);

  // @cache-components-only:start
  if (selectedEventId !== null) {
    cacheTag(eventEggsTag(selectedEventId));
  }

  for (const egg of eggs) {
    cacheTag(eggTag(egg.id));
  }
  // @cache-components-only:end

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Map" style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        {events.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No events yet.</Text>
        ) : rewards.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>
            Create a reward first before placing eggs on the map.
          </Text>
        ) : (
          <MapPlacementView
            eggs={eggs}
            events={events}
            rewardEggCounts={Object.fromEntries(rewardEggCounts)}
            rewards={rewards}
            selectedEventId={selectedEventId}
            sponsorNames={Object.fromEntries(sponsors.map((sponsor) => [sponsor.id, sponsor.name]))}
          />
        )}
      </Panel>
    </Box>
  );
}
