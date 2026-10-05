import { Box, Panel, Text } from "@bigcommerce/big-design";
import { MapPlacementView } from "@/components/huntry/map/map-placement-view";
import { DEFAULT_QUERY } from "@/lib/huntry/events/query";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { parseSelectedEventId } from "@/lib/huntry/map/query";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
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
  cacheTag(EVENTS_LIST_TAG);
  // @cache-components-only:end

  const events = await fetchEvents(DEFAULT_QUERY, storeHash);

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }
  // @cache-components-only:end

  const requestedEventId = parseSelectedEventId(searchParams);
  const requestedEvent = events.find((event) => event.id === requestedEventId);
  const liveEvent = events.find((event) => event.status === "live");
  const selectedEventId = (requestedEvent ?? liveEvent ?? events[0])?.id ?? null;

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Map" style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        {events.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No events yet.</Text>
        ) : (
          <MapPlacementView events={events} selectedEventId={selectedEventId} />
        )}
      </Panel>
    </Box>
  );
}
