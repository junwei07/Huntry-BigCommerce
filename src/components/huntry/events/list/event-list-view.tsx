import { Box, Flex, Panel, Text } from "@bigcommerce/big-design";
import { EventCard } from "@/components/huntry/events/list/event-card";
import { NewEventButton } from "@/components/huntry/events/list/new-event-button";
import { SortToggle } from "@/components/huntry/events/list/sort-toggle";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { parseEventsQuery } from "@/lib/huntry/events/query";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
// @cache-components-only:end

export async function EventListView({
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

  const query = parseEventsQuery(searchParams);
  const events = await fetchEvents(query, storeHash);

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }
  // @cache-components-only:end

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <Panel header="Events" style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        <Flex alignItems="center" justifyContent="space-between" marginBottom="medium">
          <SortToggle query={query} />
          <NewEventButton />
        </Flex>

        {events.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No events yet.</Text>
        ) : (
          <Flex flexDirection="column" flexGap="0.75rem">
            {events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </Flex>
        )}
      </Panel>
    </Box>
  );
}
