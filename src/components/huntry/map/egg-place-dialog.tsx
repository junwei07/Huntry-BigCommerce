"use client";

import { useState } from "react";
import { Box, Flex, Input, Modal, Small, Text } from "@bigcommerce/big-design";
import { MAX_EGG_NAME_LENGTH } from "@/lib/huntry/eggs/egg-form-schema";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { eggMarkerColor, HUNTRY_COLORS } from "@/lib/huntry/theme";

export interface RewardChoice {
  reward: HuntryReward;
  sponsorName: string | null;
  remaining: number;
  // False when the reward has no room left (an edited egg's own reward stays
  // selectable — it already holds one of the slots).
  selectable: boolean;
}

// Port of huntry_render_map_place_modal (huntry/includes/map/page.php) and
// renderRewardCards (huntry-admin-map.js): name, searchable reward cards with
// an "N left" chip, the coordinates, and — when editing — "Edit Location".
// Rendered only while open (parents mount/unmount it), so its state resets
// per use without an effect.
export function EggPlaceDialog({
  mode,
  choices,
  initialName,
  initialRewardId,
  lat,
  lng,
  isSaving,
  onSubmit,
  onCancel,
  onEditLocation,
}: {
  mode: "place" | "edit";
  choices: RewardChoice[];
  initialName: string;
  initialRewardId: number | null;
  lat: number;
  lng: number;
  isSaving?: boolean;
  onSubmit: (value: { name: string; rewardId: number }) => void;
  onCancel: () => void;
  onEditLocation?: (value: { name: string; rewardId: number | null }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [search, setSearch] = useState("");
  const [rewardId, setRewardId] = useState<number | null>(initialRewardId);

  const query = search.trim().toLowerCase();
  const visibleChoices = choices.filter(
    ({ reward, sponsorName }) =>
      !query || reward.name.toLowerCase().includes(query) || (sponsorName ?? "").toLowerCase().includes(query),
  );
  const canSubmit = choices.some((choice) => choice.reward.id === rewardId && choice.selectable);

  return (
    <Modal
      actions={[
        { text: "Cancel", variant: "subtle", onClick: onCancel },
        {
          text: mode === "edit" ? "Save Changes" : "Place Item",
          variant: "primary",
          disabled: !canSubmit,
          isLoading: isSaving,
          onClick: () => rewardId !== null && onSubmit({ name: name.trim(), rewardId }),
        },
      ]}
      closeOnEscKey
      header={mode === "edit" ? "Edit Egg" : "Place New Egg"}
      isOpen
      onClose={onCancel}
    >
      <Input
        label="Egg Name"
        maxLength={MAX_EGG_NAME_LENGTH}
        onChange={(event) => setName(event.target.value)}
        placeholder="Leave blank to auto-name"
        value={name}
      />

      <Box marginTop="medium">
        <Input
          label="Reward"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search rewards..."
          type="search"
          value={search}
        />
      </Box>

      <Box marginTop="small" style={{ maxHeight: "16rem", overflowY: "auto" }}>
        {visibleChoices.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No rewards match your search.</Text>
        ) : (
          visibleChoices.map(({ reward, sponsorName, remaining, selectable }) => {
            const meta = [sponsorName, reward.rewardExpiresAt ? `Exp: ${reward.rewardExpiresAt.toLocaleDateString()}` : null]
              .filter(Boolean)
              .join(" • ");

            return (
              <label
                key={reward.id}
                style={{
                  alignItems: "center",
                  border: `1px solid ${rewardId === reward.id ? HUNTRY_COLORS.primary : "#E5E5EA"}`,
                  borderRadius: "0.5rem",
                  cursor: selectable ? "pointer" : "not-allowed",
                  display: "flex",
                  gap: "0.75rem",
                  marginBottom: "0.5rem",
                  opacity: selectable ? 1 : 0.5,
                  padding: "0.75rem",
                }}
              >
                <input
                  checked={rewardId === reward.id}
                  disabled={!selectable}
                  name="egg-reward"
                  onChange={() => setRewardId(reward.id)}
                  type="radio"
                />
                <span
                  style={{
                    backgroundColor: eggMarkerColor(reward.id),
                    borderRadius: "50%",
                    flexShrink: 0,
                    height: "0.75rem",
                    width: "0.75rem",
                  }}
                />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text bold margin="none">
                    {reward.name}
                  </Text>
                  {meta ? <Small>{meta}</Small> : null}
                </Box>
                <span
                  style={{
                    backgroundColor: HUNTRY_COLORS.background,
                    borderRadius: "999px",
                    color: HUNTRY_COLORS.textMuted,
                    fontSize: "0.75rem",
                    padding: "0.125rem 0.5rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {remaining} left
                </span>
              </label>
            );
          })
        )}
      </Box>

      <Flex alignItems="center" flexDirection="row" justifyContent="space-between" marginTop="medium">
        <Small>
          Lat: {lat.toFixed(6)} &nbsp; Lng: {lng.toFixed(6)}
        </Small>
        {mode === "edit" && onEditLocation ? (
          <button
            onClick={() => onEditLocation({ name: name.trim(), rewardId })}
            style={{
              alignItems: "center",
              background: "none",
              border: "none",
              color: HUNTRY_COLORS.link,
              cursor: "pointer",
              display: "inline-flex",
              gap: "0.25rem",
            }}
            type="button"
          >
            <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
            </svg>
            <span style={{ textDecoration: "underline" }}>Edit Location</span>
          </button>
        ) : null}
      </Flex>
    </Modal>
  );
}
