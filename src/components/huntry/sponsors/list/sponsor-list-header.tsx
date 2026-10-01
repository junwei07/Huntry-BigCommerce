import { Box, Text } from "@bigcommerce/big-design";
import { SPONSOR_ROW_GRID_TEMPLATE } from "@/components/huntry/sponsors/list/sponsor-row-grid";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Column-header row ported from huntry/EVMS's CompanyCard list
// (company_page.dart's _buildCompanyListHeader): 14px/w500 labels over a
// bottom-only divider. Uses the exact same CSS Grid template as
// SponsorCard (SPONSOR_ROW_GRID_TEMPLATE) rather than approximating each
// column's width independently with Flex spacers — see event-row-grid.ts
// for why that drifted out of alignment. The thumbnail and kebab columns
// are just empty grid cells, matching SponsorCard's layout.
export function SponsorListHeader() {
  return (
    <Box
      style={{
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: SPONSOR_ROW_GRID_TEMPLATE,
        padding: "0 12px 8px",
      }}
    >
      <Box />

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Company Name
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text, fontSize: "14px", fontWeight: 500 }}>
        Added date
      </Text>

      <Box />
    </Box>
  );
}
