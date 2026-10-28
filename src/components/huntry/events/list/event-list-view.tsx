import { Box, Flex, InlineMessage, Panel, Text } from "@bigcommerce/big-design";
import { EventCard } from "@/components/huntry/events/list/event-card";
import { EventListHeader } from "@/components/huntry/events/list/event-list-header";
import { NewEventButton } from "@/components/huntry/events/list/new-event-button";
import { SortSelect } from "@/components/huntry/events/list/sort-select";
import { PageTitle } from "@/components/huntry/page-title";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { MAX_EVENTS } from "@/lib/huntry/events/limits";
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

  // The events list is unfiltered (search params only affect sort order), so
  // its length is the true count.
  const limitReached = events.length >= MAX_EVENTS;

  return (
    <Box padding="medium">
      <Panel style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        <PageTitle>Events</PageTitle>
        {limitReached ? (
          <Box marginBottom="medium">
            <InlineMessage
              header="Event limit reached"
              messages={[{ text: "You have reached your event limit." }]}
              type="info"
            />
          </Box>
        ) : null}

        <Flex alignItems="center" justifyContent="space-between" marginBottom="medium">
          <SortSelect query={query} />
          <NewEventButton limitReached={limitReached} />
        </Flex>

        <EventListHeader />

        {events.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No events yet.</Text>
        ) : (
          <Flex flexDirection="column" flexGap="0.75rem" marginTop="small">
            {events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </Flex>
        )}
      </Panel>
    </Box>
  );
}
