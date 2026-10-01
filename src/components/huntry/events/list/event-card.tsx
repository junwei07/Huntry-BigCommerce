import { Box, Text } from "@bigcommerce/big-design";
import { EventActionsMenu } from "@/components/huntry/events/list/event-actions-menu";
import { EVENT_ROW_GRID_TEMPLATE } from "@/components/huntry/events/list/event-row-grid";
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
//
// CSS Grid, not Flex — EVENT_ROW_GRID_TEMPLATE is shared with
// EventListHeader so column widths come from the template alone, not from
// what's rendered in a cell (the status pill's intrinsic width varies a
// lot between "Live" and "Not Scheduled", which drifted a Flex-based
// header out of alignment with the cards — see HBC-CHANGELOG.md).
export function EventCard({ event }: { event: HuntryEvent }) {
  return (
    <Box
      style={{
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "12px",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: EVENT_ROW_GRID_TEMPLATE,
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
          height: "60px",
          width: "80px",
        }}
      />

      <Box>
        <Text bold margin="none" style={{ color: HUNTRY_COLORS.text }}>
          {event.name}
        </Text>
        <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
          {formatDateRange(event.startsAt, event.endsAt)}
        </Text>
      </Box>

      <Box
        style={{
          backgroundColor: `${EVENT_STATUS_COLOR[event.status]}22`,
          borderRadius: "9999px",
          color: EVENT_STATUS_COLOR[event.status],
          fontSize: "12px",
          fontWeight: 700,
          justifySelf: "start",
          padding: "4px 12px",
          textTransform: "uppercase",
        }}
      >
        {EVENT_STATUS_LABEL[event.status]}
      </Box>

      <Box style={{ justifySelf: "center" }}>
        <EventActionsMenu event={event} />
      </Box>
    </Box>
  );
}
