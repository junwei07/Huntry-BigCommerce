import { Box, Flex, Text } from "@bigcommerce/big-design";
import { RewardActionsMenu } from "@/components/huntry/rewards/list/reward-actions-menu";
import { REWARD_ROW_GRID_TEMPLATE } from "@/components/huntry/rewards/list/reward-row-grid";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Copied from event-card.tsx's own formatDateRange — same "Not scheduled"
// fallback and em-dash-joined range, since rewardStartsAt/rewardExpiresAt
// have the identical nullable-Date shape as events' startsAt/endsAt.
function formatDateRange(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt) {
    return "Not scheduled";
  }

  if (!endsAt) {
    return dateFormatter.format(startsAt);
  }

  return `${dateFormatter.format(startsAt)} — ${dateFormatter.format(endsAt)}`;
}

function formatDiscount(reward: HuntryReward): string {
  return reward.discountType === "percent" ? `${reward.discountValue}% off` : `$${reward.discountValue.toFixed(2)} off`;
}

// Row-card layout mirroring EventCard/SponsorCard — no leading thumbnail
// column (rewards themselves have no logo/banner field). The name itself is
// deliberately not a link — only the kebab menu's Edit item navigates, same
// reasoning as the other two cards.
//
// CSS Grid, not Flex — REWARD_ROW_GRID_TEMPLATE is shared with
// RewardListHeader so column widths come from the template alone, not from
// what's rendered in a cell — see event-row-grid.ts for the bug this
// avoids.
export function RewardCard({ reward, sponsor }: { reward: HuntryReward; sponsor: HuntrySponsor | null }) {
  return (
    <Box
      style={{
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "12px",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: REWARD_ROW_GRID_TEMPLATE,
        padding: "12px",
      }}
    >
      <Text bold margin="none" style={{ color: HUNTRY_COLORS.text }}>
        {reward.name}
      </Text>

      {sponsor ? (
        <Flex alignItems="center" flexGap="0.5rem">
          <Box
            style={{
              backgroundColor: sponsor.logoUrl ? undefined : HUNTRY_COLORS.background,
              backgroundImage: sponsor.logoUrl ? `url(${sponsor.logoUrl})` : undefined,
              backgroundPosition: "center",
              backgroundSize: "cover",
              borderRadius: "6px",
              flexShrink: 0,
              height: "24px",
              width: "24px",
            }}
          />
          <Text
            margin="none"
            style={{
              color: HUNTRY_COLORS.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sponsor.name}
          </Text>
        </Flex>
      ) : (
        <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
          —
        </Text>
      )}

      <Text margin="none" style={{ color: HUNTRY_COLORS.text }}>
        {formatDateRange(reward.rewardStartsAt, reward.rewardExpiresAt)}
      </Text>

      <Text margin="none" style={{ color: HUNTRY_COLORS.text }}>
        {formatDiscount(reward)}
      </Text>

      <Box
        style={{
          backgroundColor: `${HUNTRY_COLORS.textMuted}22`,
          borderRadius: "9999px",
          color: HUNTRY_COLORS.textMuted,
          fontSize: "12px",
          fontWeight: 700,
          justifySelf: "start",
          padding: "4px 12px",
          textTransform: "uppercase",
        }}
      >
        {reward.discountScope === "specific" ? "Specific products" : "All products"}
      </Box>

      <Box style={{ justifySelf: "center" }}>
        <RewardActionsMenu reward={reward} />
      </Box>
    </Box>
  );
}
