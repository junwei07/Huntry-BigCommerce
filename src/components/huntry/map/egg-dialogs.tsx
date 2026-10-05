"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, ButtonProps, Flex, Text } from "@bigcommerce/big-design";
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

interface DialogAction extends Pick<ButtonProps, "variant" | "actionType" | "isLoading"> {
  text: string;
  onClick: () => void;
}

// BigDesign's Modal can't be narrowed (its dialog variant stretches to the
// page width), so the small confirmations use this 380px card instead, like
// the plugin's .huntry-unsaved-modal__dialog: content centered, buttons
// splitting the width. Portaled above the full-screen map (z-index 1000).
function ConfirmDialog({
  actions,
  onClose,
  children,
}: {
  actions: DialogAction[];
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 19, 34, 0.5)",
      }}
    >
      <div
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={{
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          boxSizing: "border-box",
          padding: "24px 20px 20px",
          backgroundColor: "#fff",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(15, 19, 34, 0.25)",
        }}
      >
        {children}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          {actions.map((action) => (
            <div key={action.text} style={{ display: "flex", flex: "1 1 0", justifyContent: "center" }}>
              <Button
                actionType={action.actionType}
                isLoading={action.isLoading}
                onClick={action.onClick}
                variant={action.variant}
              >
                {action.text}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
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
    <ConfirmDialog
      actions={[
        { text: "Cancel", variant: "subtle", onClick: onCancel },
        { text: "Delete", variant: "primary", actionType: "destructive", isLoading: isDeleting, onClick: onConfirm },
      ]}
      onClose={onCancel}
    >
      <DialogBody headline={`Are you sure you want to delete this ${isClaimed ? "claimed " : ""}item?`} icon="⚠">
        <Text bold style={{ color: HUNTRY_COLORS.textMuted }}>{eggName}</Text>
        {isClaimed ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>
            This item has already been claimed. Deleting it will not affect the player&apos;s claimed reward.
          </Text>
        ) : null}
      </DialogBody>
    </ConfirmDialog>
  );
}

// huntry_render_map_egg_limit_modal, minus the plugin's "Find out more"
// upsell CTA (no BigCommerce equivalent).
export function EggLimitDialog({ onClose }: { onClose: () => void }) {
  return (
    <ConfirmDialog actions={[{ text: "Close", variant: "primary", onClick: onClose }]} onClose={onClose}>
      <DialogBody headline="You've reached the maximum number of eggs" icon="🔒">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>
          This event allows up to {MAX_EGGS_PER_EVENT} eggs across all rewards.
        </Text>
      </DialogBody>
    </ConfirmDialog>
  );
}

// huntry_render_map_proximity_modal.
export function EggProximityDialog({ radiusMeters, onClose }: { radiusMeters: number; onClose: () => void }) {
  return (
    <ConfirmDialog actions={[{ text: "Got it", variant: "primary", onClick: onClose }]} onClose={onClose}>
      <DialogBody headline="Too close to another egg" icon="⚠">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>
          Move at least {radiusMeters}m away from the nearest egg to place a new one.
        </Text>
      </DialogBody>
    </ConfirmDialog>
  );
}

// huntry_render_unsaved_changes_modal (huntry/includes/admin/index.php).
export function UnsavedChangesDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  return (
    <ConfirmDialog
      actions={[
        { text: "Stay on this page", variant: "subtle", onClick: onStay },
        { text: "Leave without saving", variant: "primary", actionType: "destructive", onClick: onLeave },
      ]}
      onClose={onStay}
    >
      <DialogBody headline="You have unsaved changes" icon="⚠">
        <Text style={{ color: HUNTRY_COLORS.textMuted }}>If you leave this page now, your changes will be lost.</Text>
      </DialogBody>
    </ConfirmDialog>
  );
}
