"use client";

import { Flex, Modal, Text } from "@bigcommerce/big-design";
import { MAX_EGGS_PER_EVENT } from "@/lib/huntry/eggs/limits";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Centered icon + headline + body shared by every small confirmation dialog,
// matching the plugin's __icon / __headline / __message structure.
function DialogBody({ icon, headline, children }: { icon: string; headline: string; children?: React.ReactNode }) {
  return (
    <Flex alignItems="center" flexDirection="column" style={{ textAlign: "center" }}>
      <span aria-hidden style={{ fontSize: "2.5rem", color: HUNTRY_COLORS.primary }}>
        {icon}
      </span>
      <Text bold>{headline}</Text>
      {children}
    </Flex>
  );
}

// huntry_render_map_delete_egg_modal / ..._delete_claimed_egg_modal. The
// claimed variant reassures the admin that the player's reward is unaffected
// (deleting never touches huntry_claims); it only becomes reachable once
// claim data exists (BC-HUN-032).
export function EggDeleteDialog({
  eggName,
  isClaimed,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  eggName: string;
  isClaimed: boolean;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      actions={[
        { text: "Cancel", variant: "subtle", onClick: onCancel },
        { text: "Delete", variant: "primary", actionType: "destructive", isLoading: isDeleting, onClick: onConfirm },
      ]}
      closeOnEscKey
      header={isClaimed ? "Delete Claimed Item" : "Delete Item"}
      isOpen
      onClose={onCancel}
      variant="dialog"
    >
      <DialogBody headline={`Are you sure you want to delete this ${isClaimed ? "claimed " : ""}item?`} icon="⚠">
        <Text bold>{eggName}</Text>
        {isClaimed ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>
            This item has already been claimed. Deleting it will not affect the player&apos;s claimed reward.
          </Text>
        ) : null}
      </DialogBody>
    </Modal>
  );
}

// huntry_render_map_egg_limit_modal, minus the plugin's "Find out more"
// upsell CTA (no BigCommerce equivalent).
export function EggLimitDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      actions={[{ text: "Close", variant: "primary", onClick: onClose }]}
      closeOnEscKey
      isOpen
      onClose={onClose}
      variant="dialog"
    >
      <DialogBody headline="You've reached the maximum number of eggs" icon="🔒">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>
          This event allows up to {MAX_EGGS_PER_EVENT} eggs across all rewards.
        </Text>
      </DialogBody>
    </Modal>
  );
}

// huntry_render_map_proximity_modal.
export function EggProximityDialog({ radiusMeters, onClose }: { radiusMeters: number; onClose: () => void }) {
  return (
    <Modal
      actions={[{ text: "Got it", variant: "primary", onClick: onClose }]}
      closeOnEscKey
      isOpen
      onClose={onClose}
      variant="dialog"
    >
      <DialogBody headline="Too close to another egg" icon="⚠">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>
          Move at least {radiusMeters}m away from the nearest egg to place a new one.
        </Text>
      </DialogBody>
    </Modal>
  );
}

// huntry_render_unsaved_changes_modal (huntry/includes/admin/index.php).
export function UnsavedChangesDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  return (
    <Modal
      actions={[
        { text: "Stay on this page", variant: "subtle", onClick: onStay },
        { text: "Leave without saving", variant: "primary", actionType: "destructive", onClick: onLeave },
      ]}
      closeOnEscKey
      isOpen
      onClose={onStay}
      variant="dialog"
    >
      <DialogBody headline="You have unsaved changes" icon="⚠">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>If you leave this page now, your changes will be lost.</Text>
      </DialogBody>
    </Modal>
  );
}
