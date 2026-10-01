import { Box, Flex, FlexItem, Text } from "@bigcommerce/big-design";
import { EventActionsMenu } from "@/components/huntry/events/list/event-actions-menu";
import { EVENT_STATUS_COLOR, EVENT_STATUS_LABEL } from "@/lib/huntry/events/status";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDateRange(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt) {
    return "Not scheduled";
  }

  if (!endsAt) {
    return dateFormatter.format(startsAt);
  }

  return `${dateFormatter.format(startsAt)} — ${dateFormatter.format(endsAt)}`;
}

// Row-card layout, ported from huntry/EVMS's EventCard
// (huntry/EVMS/lib/feature/event_setting/event_page/view/event_card_view.dart)
// rather than this app's own Table convention used elsewhere (gift
// certificates, customers) — see docs/HUNTRY-UI-REFERENCE.md. The name
// itself is deliberately not a link — only the kebab menu's Edit item
// navigates to events/[id] (EVMS points its card's name at a different
// destination, a per-event dashboard this app doesn't have).
export function EventCard({ event }: { event: HuntryEvent }) {
  return (
    <Flex
      alignItems="center"
      flexGap="1rem"
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "12px",
        padding: "12px",
      }}
    >
      <Box
        style={{
          backgroundColor: event.headerBannerUrl ? undefined : HUNTRY_COLORS.background,
          backgroundImage: event.headerBannerUrl ? `url(${event.headerBannerUrl})` : undefined,
          backgroundPosition: "center",
          backgroundSize: "cover",
          borderRadius: "8px",
          flexShrink: 0,
          height: "60px",
          width: "80px",
        }}
      />

      <FlexItem flexGrow={1}>
        <Text bold margin="none" style={{ color: HUNTRY_COLORS.text }}>
          {event.name}
        </Text>
        <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
          {formatDateRange(event.startsAt, event.endsAt)}
        </Text>
      </FlexItem>

      <Box
        style={{
          backgroundColor: `${EVENT_STATUS_COLOR[event.status]}22`,
          borderRadius: "9999px",
          color: EVENT_STATUS_COLOR[event.status],
          fontSize: "12px",
          fontWeight: 700,
          padding: "4px 12px",
          textTransform: "uppercase",
        }}
      >
        {EVENT_STATUS_LABEL[event.status]}
      </Box>

      <EventActionsMenu event={event} />
    </Flex>
  );
}
