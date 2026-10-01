import { Box, Text } from "@bigcommerce/big-design";
import { EVENT_ROW_GRID_TEMPLATE } from "@/components/huntry/events/list/event-row-grid";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Column-header row, same visual treatment as SponsorListHeader (itself
// ported from huntry/EVMS's CompanyCard list header) — EVMS's own event
// listing page has no equivalent header to port directly (confirmed: only
// a section title + search bar sit above its event list), so this is a
// new header extrapolated from that same pattern, applied over
// EventCard's existing columns.
//
// Uses the exact same CSS Grid template as EventCard (EVENT_ROW_GRID_TEMPLATE)
// rather than approximating each column's width independently — a fixed
// Flex spacer here previously drifted out of alignment with the status
// pill's intrinsic, label-length-dependent width (see HBC-CHANGELOG.md).
// The thumbnail and kebab columns are just empty grid cells, matching
// EventCard's layout without needing their own spacer content.
export function EventListHeader() {
  return (
    <Box
      style={{
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: EVENT_ROW_GRID_TEMPLATE,
        padding: "0 12px 8px",
      }}
    >
      <Box />

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Name
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Status
      </Text>

      <Box />
    </Box>
  );
}
