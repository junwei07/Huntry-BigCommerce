import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventStatus } from "@/lib/huntry/events/types";

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  "not-scheduled": "Not Scheduled",
  upcoming: "Upcoming",
  live: "Live",
  ended: "Ended",
};

// EventCard renders status as a small custom-styled pill rather than
// BigDesign's Badge — Badge only accepts its own theme's variant names, not
// arbitrary hex, and these colors are sourced from EVMS's event card
// (huntry/EVMS/lib/feature/event_setting/event_page/view/event_card_view.dart)
// rather than BigDesign's palette. See docs/HUNTRY-UI-REFERENCE.md.
export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  "not-scheduled": HUNTRY_COLORS.textMuted,
  upcoming: HUNTRY_COLORS.primary,
  live: HUNTRY_COLORS.live,
  ended: HUNTRY_COLORS.textMuted,
};
