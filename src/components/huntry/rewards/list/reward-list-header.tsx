import { Box, Text } from "@bigcommerce/big-design";
import { REWARD_ROW_GRID_TEMPLATE } from "@/components/huntry/rewards/list/reward-row-grid";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Column-header row, same visual treatment as EventListHeader/
// SponsorListHeader. Uses the exact same CSS Grid template as RewardCard
// (REWARD_ROW_GRID_TEMPLATE) rather than approximating each column's width
// independently — see event-row-grid.ts for why a Flex-based header
// previously drifted out of alignment with intrinsically-sized card
// content. No leading blank thumbnail cell here, unlike events/sponsors —
// rewards have no image field, so the grid starts directly at Name.
export function RewardListHeader() {
  return (
    <Box
      style={{
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: REWARD_ROW_GRID_TEMPLATE,
        padding: "0 12px 8px",
      }}
    >
      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Name
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Sponsor
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Validity
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Discount
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Scope
      </Text>

      <Box />
    </Box>
  );
}
