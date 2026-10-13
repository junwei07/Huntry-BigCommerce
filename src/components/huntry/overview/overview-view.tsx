import { Box, Panel, Text } from "@bigcommerce/big-design";
import { EventPicker } from "@/components/huntry/overview/event-picker";
import { ActivityItem, GameActivityPanel } from "@/components/huntry/overview/game-activity-panel";
import { LeaderboardPanel } from "@/components/huntry/overview/leaderboard-panel";
import { OverviewMap } from "@/components/huntry/overview/overview-map";
import { decorateClaimsWithCustomers, decorateLeaderboardWithCustomers } from "@/lib/huntry/claims/decorate-with-customers";
import { fetchEggClaimCounts } from "@/lib/huntry/claims/claims-api";
import { fetchGameActivity, GAME_ACTIVITY_LIMIT } from "@/lib/huntry/claims/game-activity";
import { fetchLeaderboard } from "@/lib/huntry/claims/leaderboard";
import { fetchEggs } from "@/lib/huntry/eggs/eggs-api";
import { DEFAULT_QUERY } from "@/lib/huntry/events/query";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { resolveItemMarkerUrl } from "@/lib/huntry/events/marker-urls";
import { parseSelectedEventId } from "@/lib/huntry/map/query";
import { DEFAULT_QUERY as DEFAULT_REWARDS_QUERY } from "@/lib/huntry/rewards/query";
import { fetchRewards } from "@/lib/huntry/rewards/rewards-api";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { eventClaimsTag } from "@/lib/huntry/claims/cache-tags";
import { eggTag, EGGS_LIST_TAG, eventEggsTag } from "@/lib/huntry/eggs/cache-tags";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
// @cache-components-only:end

const panelStyle = {
  background: "#fff",
  border: "1px solid #E5E5EA",
  borderRadius: 12,
  padding: "16px 20px 20px",
} as const;

// Layout mirrors huntry_render_overview_page() (huntry/includes/overview/index.php):
// Hunt picker, then a left column (Map above Game activity) beside the Leaderboard.
export async function OverviewView({
  searchParams,
  storeHash,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  storeHash: string | undefined;
}) {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EVENTS_LIST_TAG, REWARDS_LIST_TAG, EGGS_LIST_TAG);
  // @cache-components-only:end

  const [events, rewards] = await Promise.all([
    fetchEvents(DEFAULT_QUERY, storeHash),
    fetchRewards(DEFAULT_REWARDS_QUERY, storeHash),
  ]);

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }

  for (const reward of rewards) {
    cacheTag(rewardTag(reward.id));
  }
  // @cache-components-only:end

  const requestedEventId = parseSelectedEventId(searchParams);
  const selectedEvent =
    events.find((event) => event.id === requestedEventId) ??
    events.find((event) => event.status === "live") ??
    events[0];
  const pickerEvents = events.map((event) => ({ id: event.id, name: event.name, status: event.status }));

  if (!selectedEvent) {
    return (
      <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
        <Panel header="Overview">
          <EventPicker events={pickerEvents} selectedEventId={null} />
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>Create an event first to see its overview.</Text>
        </Panel>
      </Box>
    );
  }

  const [eggs, claimCounts, leaderboardEntries, activityClaims] = await Promise.all([
    fetchEggs(selectedEvent.id, storeHash),
    fetchEggClaimCounts(selectedEvent.id, storeHash),
    fetchLeaderboard(selectedEvent.id, storeHash),
    fetchGameActivity(selectedEvent.id, storeHash),
  ]);
  const [leaderboard, activity] = await Promise.all([
    decorateLeaderboardWithCustomers(leaderboardEntries, storeHash),
    decorateClaimsWithCustomers(activityClaims, storeHash),
  ]);

  // Only what the panels render crosses to the client (no emails, no Dates in the map props).
  const activityItems: ActivityItem[] = activity.map((row) => {
    const customer = row.customer;

    return {
      id: row.id,
      playerName: customer ? customer.name || customer.email : `Customer #${row.bcCustomerId}`,
      rewardName: row.rewardNameSnapshot,
      couponCode: row.couponCode,
      claimedAt: row.claimedAt.toISOString(),
      isForced: row.isForced,
      forcedByLabel: row.forcedByUserId === null ? null : `admin #${row.forcedByUserId}`,
      redemptionStatus: row.redemptionStatus,
    };
  });
  const mapEggs = eggs.map((egg) => ({ id: egg.id, rewardId: egg.rewardId, name: egg.name, lat: egg.lat, lng: egg.lng }));
  const rewardNames = Object.fromEntries(rewards.map((reward) => [reward.id, reward.name]));
  // Forced claims count toward capacity, same as the Map tab.
  const claimCountByEgg = Object.fromEntries([...claimCounts].map(([eggId, value]) => [eggId, value.count]));

  // @cache-components-only:start
  cacheTag(eventClaimsTag(selectedEvent.id), eventEggsTag(selectedEvent.id));

  for (const egg of eggs) {
    cacheTag(eggTag(egg.id));
  }
  // @cache-components-only:end

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Overview">
        <EventPicker events={pickerEvents} selectedEventId={selectedEvent.id} />
        {/* Plain flex rows (not BigDesign Panels) so the leaderboard stretches to the left column's height, as in WP. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 16 }}>
          <div style={{ flex: "2 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <section style={panelStyle}>
              <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: HUNTRY_COLORS.text }}>Map</h2>
              <OverviewMap
                claimCapacity={selectedEvent.eggClaimCapacity}
                claimCounts={claimCountByEgg}
                eggs={mapEggs}
                itemMarkerUrl={resolveItemMarkerUrl(selectedEvent.theme.itemMarker)}
                key={selectedEvent.id}
                rewardNames={rewardNames}
              />
            </section>
            <GameActivityPanel items={activityItems} limit={GAME_ACTIVITY_LIMIT} />
          </div>
          <LeaderboardPanel rows={leaderboard} />
        </div>
      </Panel>
    </Box>
  );
}
