// Shared by event-card.tsx and event-list-header.tsx — a CSS Grid template,
// not a Flex ratio, so column widths come from this template alone and
// never depend on what's rendered in a given cell that row (an
// intrinsically-sized status pill, "Live" vs. "Not Scheduled", would
// otherwise push everything after it by a different amount per row — see
// HBC-CHANGELOG.md's note on this fix). 140px for the status column
// comfortably fits "Not Scheduled", the longest EVENT_STATUS_LABEL value.
export const EVENT_ROW_GRID_TEMPLATE = "80px 1fr 140px 48px";
