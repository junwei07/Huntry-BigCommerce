import { Box, Text } from "@bigcommerce/big-design";
import { SponsorActionsMenu } from "@/components/huntry/sponsors/list/sponsor-actions-menu";
import { SPONSOR_ROW_GRID_TEMPLATE } from "@/components/huntry/sponsors/list/sponsor-row-grid";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Row-card layout mirroring EventCard — no status badge (sponsors have no
// status column). The name itself is deliberately not a link — only the
// kebab menu's Edit item navigates, same reasoning as EventCard.
//
// Name and the date are two side-by-side CSS Grid columns (flex 2/1
// equivalent, matching huntry/EVMS's CompanyCard desktop row split) rather
// than stacked in one block — SponsorListHeader's two column labels only
// line up visually because of this split. Grid, not Flex — the shared
// SPONSOR_ROW_GRID_TEMPLATE guarantees the header and every card use
// identical column widths regardless of each cell's content (see
// event-row-grid.ts for why, and HBC-CHANGELOG.md for the bug this fixed).
// Location is no longer shown here (still a real, editable field on the
// form) — the user explicitly chose to match EVMS's "Company
// Name"/"Added date" header over keeping Location as the second column.
export function SponsorCard({ sponsor }: { sponsor: HuntrySponsor }) {
  return (
    <Box
      style={{
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "12px",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: SPONSOR_ROW_GRID_TEMPLATE,
        padding: "12px",
      }}
    >
      <Box
        style={{
          backgroundColor: sponsor.logoUrl ? undefined : HUNTRY_COLORS.background,
          backgroundImage: sponsor.logoUrl ? `url(${sponsor.logoUrl})` : undefined,
          backgroundPosition: "center",
          backgroundSize: "cover",
          borderRadius: "8px",
          height: "60px",
          width: "60px",
        }}
      />

      <Text bold margin="none" style={{ color: HUNTRY_COLORS.text }}>
        {sponsor.name}
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
        {dateFormatter.format(sponsor.createdAt)}
      </Text>

      <Box style={{ justifySelf: "center" }}>
        <SponsorActionsMenu sponsor={sponsor} />
      </Box>
    </Box>
  );
}
