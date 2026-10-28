import { Box, Button, Flex, Text } from "@bigcommerce/big-design";
import {
  EggDeleteDialog,
  EggForceClaimDialog,
  EggLimitDialog,
  EggProximityDialog,
  UnsavedChangesDialog,
} from "@/components/huntry/map/egg-dialogs";
import { EggPlaceDialog } from "@/components/huntry/map/egg-place-dialog";
import type { Dialog, EditLocation } from "@/components/huntry/map/map-types";
import { eggClaimStatus } from "@/lib/huntry/claims/egg-claim-status";
import type { EggClaimCount } from "@/lib/huntry/claims/types";
import type { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { buildRewardChoices } from "@/lib/huntry/map/reward-choices";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { eggMarkerColor, HUNTRY_COLORS } from "@/lib/huntry/theme";

// Presentational pieces of MapPlacementView: props in, JSX out, no state or
// effects of their own.

export function PlacingToolbar({
  pendingCount,
  isSaving,
  onStop,
}: {
  pendingCount: number;
  isSaving: boolean;
  onStop: () => void;
}) {
  return (
    <Flex
      alignItems="center"
      flexDirection="row"
      justifyContent="space-between"
      padding="small"
      style={{ backgroundColor: HUNTRY_COLORS.background, borderBottom: "1px solid #E5E5EA" }}
    >
      <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
        Click the map to place an egg.{" "}
        {pendingCount > 0 ? `${pendingCount} pending — saved when you stop placing.` : ""}
      </Text>
      {/* BigDesign's Button drops style/className, so the red is
          applied to its .bd-button via this wrapper (egg-marker.css). */}
      <span className="huntry-stop-placing">
        <Button isLoading={isSaving} onClick={onStop} variant="secondary">
          Stop Placing
        </Button>
      </span>
    </Flex>
  );
}

export function EditLocationBar({
  editLocation,
  markerRadiusMeters,
  isSaving,
  onCancel,
  onConfirm,
}: {
  editLocation: EditLocation;
  markerRadiusMeters: number;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Flex
      alignItems="center"
      flexDirection="row"
      justifyContent="space-between"
      padding="small"
      style={{
        backgroundColor: editLocation.valid ? HUNTRY_COLORS.background : "#FDECEA",
        borderTop: "1px solid #E5E5EA",
      }}
    >
      <Box>
        <Text bold margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
          Editing location of: {editLocation.name || editLocation.egg.name || "Unnamed egg"}
        </Text>
        <Text
          margin="none"
          style={{ color: editLocation.valid ? HUNTRY_COLORS.textMuted : HUNTRY_COLORS.destructive }}
        >
          {editLocation.valid
            ? "Drag marker to update the location."
            : `Too close to another egg! Move at least ${markerRadiusMeters}m away.`}
        </Text>
      </Box>
      <Flex flexDirection="row" style={{ gap: "0.5rem" }}>
        <Button aria-label="Cancel" onClick={onCancel} variant="subtle">
          ✕
        </Button>
        <Button
          aria-label="Confirm new location"
          disabled={!editLocation.valid}
          isLoading={isSaving}
          onClick={onConfirm}
          variant="primary"
        >
          ✓
        </Button>
      </Flex>
    </Flex>
  );
}

export function RewardLegend({ rewards }: { rewards: HuntryReward[] }) {
  return (
    <Flex flexDirection="row" marginTop="small" style={{ gap: "1rem", flexWrap: "wrap" }}>
      {rewards.map((reward) => (
        <Flex alignItems="center" flexDirection="row" key={reward.id} style={{ gap: "0.375rem" }}>
          <span
            style={{
              backgroundColor: eggMarkerColor(reward.id),
              borderRadius: "50%",
              display: "inline-block",
              height: "0.75rem",
              width: "0.75rem",
            }}
          />
          <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>{reward.name}</Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function MapDialogs({
  dialog,
  isSaving,
  markerRadiusMeters,
  claimCapacity,
  claimCounts,
  rewards,
  rewardEggCounts,
  pending,
  sponsorNames,
  onClose,
  onSubmitPlace,
  onSubmitEdit,
  onBeginEditLocation,
  onConfirmDelete,
  onConfirmForceClaim,
}: {
  dialog: Dialog | null;
  isSaving: boolean;
  markerRadiusMeters: number;
  claimCapacity: number;
  claimCounts: Record<string, EggClaimCount>;
  rewards: HuntryReward[];
  rewardEggCounts: Record<number, number>;
  pending: PendingEgg[];
  sponsorNames: Record<number, string>;
  onClose: () => void;
  onSubmitPlace: (value: { name: string; rewardId: number }) => void;
  onSubmitEdit: (egg: HuntryEgg, value: { name: string; rewardId: number }) => void;
  onBeginEditLocation: (egg: HuntryEgg, value: { name: string; rewardId: number | null }) => void;
  onConfirmDelete: (egg: HuntryEgg) => void;
  onConfirmForceClaim: (egg: HuntryEgg, email: string) => void;
}) {
  const rewardChoices = (currentRewardId: number | null) =>
    buildRewardChoices(rewards, rewardEggCounts, pending, sponsorNames, currentRewardId);

  return (
    <>
      {dialog?.kind === "place" ? (
        <EggPlaceDialog
          choices={rewardChoices(null)}
          initialName=""
          initialRewardId={null}
          lat={dialog.lat}
          lng={dialog.lng}
          mode="place"
          onCancel={onClose}
          onSubmit={onSubmitPlace}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EggPlaceDialog
          choices={rewardChoices(dialog.egg.rewardId)}
          initialName={dialog.egg.name}
          initialRewardId={dialog.egg.rewardId}
          isSaving={isSaving}
          lat={dialog.egg.lat}
          lng={dialog.egg.lng}
          mode="edit"
          onCancel={onClose}
          onEditLocation={(value) => onBeginEditLocation(dialog.egg, value)}
          onSubmit={(value) => onSubmitEdit(dialog.egg, value)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <EggDeleteDialog
          eggName={dialog.egg.name || "Unnamed egg"}
          isClaimed={eggClaimStatus(claimCounts[dialog.egg.id], claimCapacity).claimed}
          isDeleting={isSaving}
          onCancel={onClose}
          onConfirm={() => onConfirmDelete(dialog.egg)}
        />
      ) : null}
      {dialog?.kind === "forceClaim" ? (
        <EggForceClaimDialog
          eggName={dialog.egg.name || "Unnamed egg"}
          isSaving={isSaving}
          onCancel={onClose}
          onConfirm={(email) => onConfirmForceClaim(dialog.egg, email)}
        />
      ) : null}
      {dialog?.kind === "limit" ? <EggLimitDialog onClose={onClose} /> : null}
      {dialog?.kind === "proximity" ? <EggProximityDialog onClose={onClose} radiusMeters={markerRadiusMeters} /> : null}
      {dialog?.kind === "unsaved" ? <UnsavedChangesDialog onLeave={dialog.onLeave} onStay={onClose} /> : null}
    </>
  );
}
