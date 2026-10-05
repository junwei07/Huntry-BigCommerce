"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Button, Dropdown, DropdownItem, Flex, Input, Select, Small, Text } from "@bigcommerce/big-design";
import { MoreHorizIcon } from "@bigcommerce/big-design-icons";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { eggMarkerColor, HUNTRY_COLORS } from "@/lib/huntry/theme";

// Claims have no data layer yet (BC-HUN-032), so every egg is "not_claimed"
// for now; the status filter is kept so the layout matches the plugin's
// huntry_render_map_items_panel and starts working once claim counts exist.
type StatusFilter = "" | "not_claimed" | "claimed";

const STATUS_OPTIONS = [
  { value: "", content: "All statuses" },
  { value: "not_claimed", content: "Not Claimed" },
  { value: "claimed", content: "Claimed" },
];

const ROW_STYLE = {
  alignItems: "center",
  borderBottom: "1px solid #E5E5EA",
  display: "flex",
  gap: "0.5rem",
  padding: "0.75rem 0.5rem",
} as const;

// The plugin's .huntry-map-items-row--highlight: orange border + soft glow.
// Same padding as ROW_STYLE (text never shifts); the ring is a box-shadow that
// fits inside the scroll container's padding below, so it isn't clipped.
const HIGHLIGHT_ROW_STYLE = {
  backgroundColor: HUNTRY_COLORS.background,
  borderRadius: "0.5rem",
  boxShadow: `0 0 0 2px ${HUNTRY_COLORS.primary}`,
  transition: "box-shadow 0.2s ease",
} as const;

function RewardBadge({ rewardId, name, muted }: { rewardId: number; name: string; muted?: boolean }) {
  return (
    <span
      style={{
        // The reward color at ~20% opacity (hex alpha "33") so the badge reads
        // as a soft tint; dark text keeps it legible on every palette color.
        backgroundColor: `${eggMarkerColor(rewardId)}33`,
        borderRadius: "999px",
        color: HUNTRY_COLORS.text,
        fontSize: "0.75rem",
        opacity: muted ? 0.65 : 1,
        padding: "0.125rem 0.5rem",
      }}
    >
      {name}
    </span>
  );
}

// Edit / Delete only — Force Claim is BC-HUN-029's. Mirrors
// RewardActionsMenu's Dropdown/kebab shape, including the key bump that
// remounts downshift's reducer after a selection.
function EggActionsMenu({ egg, onEdit, onDelete }: { egg: HuntryEgg; onEdit: () => void; onDelete: () => void }) {
  const [dropdownKey, setDropdownKey] = useState(0);

  const items: DropdownItem[] = [
    {
      content: "Edit",
      onItemClick: () => {
        onEdit();
        setDropdownKey((key) => key + 1);
      },
    },
    {
      content: "Delete",
      onItemClick: () => {
        onDelete();
        setDropdownKey((key) => key + 1);
      },
    },
  ];

  return (
    <Dropdown
      key={dropdownKey}
      items={items}
      maxHeight={250}
      placement="bottom-end"
      toggle={<Button aria-label={`Actions for ${egg.name || "egg"}`} iconOnly={<MoreHorizIcon />} variant="subtle" />}
    />
  );
}

export function EggItemsPanel({
  eggs,
  pending,
  rewards,
  onPlaceItem,
  onSelectEgg,
  onEditEgg,
  onDeleteEgg,
  onRemovePending,
  highlight,
}: {
  eggs: HuntryEgg[];
  pending: PendingEgg[];
  rewards: HuntryReward[];
  onPlaceItem: () => void;
  onSelectEgg: (egg: HuntryEgg) => void;
  onEditEgg: (egg: HuntryEgg) => void;
  onDeleteEgg: (egg: HuntryEgg) => void;
  onRemovePending: (key: string) => void;
  // Set when a marker is clicked: scrolls that egg's row into view and
  // highlights it until the parent clears it (plugin's highlightRow, 2.4 s).
  // A row hidden by the search/filters below isn't scrolled to or highlighted.
  highlight: { eggId: string; token: number } | null;
}) {
  const [search, setSearch] = useState("");
  const [rewardFilter, setRewardFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (highlight) {
      rowRefs.current.get(highlight.eggId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlight]);

  const rewardName = (rewardId: number) => rewards.find((reward) => reward.id === rewardId)?.name ?? "Unknown reward";
  const rewardOptions = [
    { value: "", content: "All rewards" },
    ...rewards.map((reward) => ({ value: String(reward.id), content: reward.name })),
  ];

  const searchTerm = search.trim().toLowerCase();
  const visibleEggs = eggs.filter((egg) => {
    if (rewardFilter && String(egg.rewardId) !== rewardFilter) {
      return false;
    }

    if (statusFilter === "claimed") {
      return false;
    }

    return !searchTerm || `${egg.name} ${rewardName(egg.rewardId)}`.toLowerCase().includes(searchTerm);
  });

  return (
    <Box
      backgroundColor="white"
      border="box"
      borderRadius="normal"
      padding="medium"
      style={{ width: "22rem", flexShrink: 0, maxHeight: "600px", display: "flex", flexDirection: "column" }}
    >
      <Flex flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom="small">
        <Box>
          <Text bold margin="none">
            Event Items
          </Text>
          <Small style={{ color: HUNTRY_COLORS.textMuted }}>
            Total placed: <strong>{eggs.length}</strong>
          </Small>
        </Box>
        <Button onClick={onPlaceItem} variant="primary">
          + Place Item
        </Button>
      </Flex>

      <Input
        label="Search"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search item or reward..."
        value={search}
      />

      <Flex flexDirection="row" marginTop="small" marginBottom="small" style={{ gap: "0.5rem" }}>
        <Select
          label="Reward"
          onOptionChange={(value) => setRewardFilter(value === null ? "" : String(value))}
          options={rewardOptions}
          value={rewardFilter}
        />
        <Select
          label="Status"
          onOptionChange={(value) => setStatusFilter((value ?? "") as StatusFilter)}
          options={STATUS_OPTIONS}
          value={statusFilter}
        />
      </Flex>

      {/* overflow-y also clips on x, so the negative margin + matching padding
          widen the clip box without shifting the layout: row highlights and
          the kebab button's focus halo then render in full. */}
      <Box style={{ overflowY: "auto", flex: 1, margin: "0 -0.5rem", padding: "0.25rem 0.5rem" }}>
        {pending.map((egg) => (
          <div key={egg.key} style={ROW_STYLE}>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text bold margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
                {egg.name || "Pending — saved when you stop placing"}
              </Text>
              <Flex flexDirection="row" marginTop="xxSmall" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                <RewardBadge muted name={rewardName(egg.rewardId)} rewardId={egg.rewardId} />
                <Small style={{ color: HUNTRY_COLORS.textMuted }}>Pending</Small>
              </Flex>
            </Box>
            <Button
              aria-label="Remove pending egg"
              onClick={() => onRemovePending(egg.key)}
              variant="subtle"
              actionType="destructive"
            >
              ✕
            </Button>
          </div>
        ))}

        {eggs.length === 0 && pending.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>
            No items placed on the map yet. Click &quot;Place Item&quot; to add the first one.
          </Text>
        ) : eggs.length > 0 && visibleEggs.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No items match your search/filters.</Text>
        ) : (
          visibleEggs.map((egg) => (
            <div
              key={egg.id}
              ref={(element) => {
                if (element) {
                  rowRefs.current.set(egg.id, element);
                } else {
                  rowRefs.current.delete(egg.id);
                }
              }}
              style={highlight?.eggId === egg.id ? { ...ROW_STYLE, ...HIGHLIGHT_ROW_STYLE } : ROW_STYLE}
            >
              <button
                onClick={() => onSelectEgg(egg)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  flex: 1,
                  minWidth: 0,
                  padding: 0,
                  textAlign: "left",
                }}
                type="button"
              >
                <Text bold margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
                  {egg.name || "Unnamed egg"}
                </Text>
                <Flex flexDirection="row" marginTop="xxSmall" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                  <RewardBadge name={rewardName(egg.rewardId)} rewardId={egg.rewardId} />
                  <span
                    style={{
                      backgroundColor: HUNTRY_COLORS.background,
                      borderRadius: "999px",
                      color: HUNTRY_COLORS.textMuted,
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.5rem",
                    }}
                  >
                    Not Claimed
                  </span>
                </Flex>
              </button>
              <EggActionsMenu egg={egg} onDelete={() => onDeleteEgg(egg)} onEdit={() => onEditEgg(egg)} />
            </div>
          ))
        )}
      </Box>
    </Box>
  );
}
