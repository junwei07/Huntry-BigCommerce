"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, DropdownItem, Modal, Text } from "@bigcommerce/big-design";
import { MoreHorizIcon } from "@bigcommerce/big-design-icons";
import { deleteHuntryEvent } from "@/app/store/[storeHash]/huntry/events/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { getAppUrl } from "@/lib/routing/app-url";

// Ported from GiftCertificateActionsMenu
// (src/components/gift-certs-manager/gift-certificates/list/gift-certificate-actions-menu.tsx)
// — same Dropdown/kebab-Button/confirm-Modal shape, matching EVMS's own
// event card 3-dot menu layout (see docs/HUNTRY-UI-REFERENCE.md).
export function EventActionsMenu({ event }: { event: HuntryEvent }) {
  const router = useRouter();
  const storeHash = useStoreHash();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Edit navigates to a route with its own not-yet-revealed Suspense
  // boundary, so it gets the same useGlobalTransition({ autoResolve: false
  // }) + EditEventForm's useClearGlobalLoading() pairing every "+ New X"
  // button already uses — see global-loading.tsx. Kept separate from the
  // plain isPending/startTransition above, which is Delete's own modal
  // spinner and shouldn't trigger the full-page overlay.
  const [, startEditTransition] = useGlobalTransition({ autoResolve: false });
  // Bumped on every selection to force Dropdown (downshift's useSelect
  // underneath) to remount with a fresh internal reducer — see
  // GiftCertificateActionsMenu for why.
  const [dropdownKey, setDropdownKey] = useState(0);

  const closeModal = () => setIsConfirmingDelete(false);

  const handleConfirmDelete = () => {
    // Closed synchronously on click, not after the action resolves — see
    // GiftCertificateActionsMenu's identical comment (avoids a stale
    // reopened modal if this component gets frozen mid-transition in
    // Next's client Router Cache).
    closeModal();

    startTransition(async () => {
      await runServerAction(() => deleteHuntryEvent(event.id, storeHash));
    });
  };

  const items: DropdownItem[] = [
    {
      content: "Edit",
      onItemClick: () => {
        startEditTransition(() => {
          router.push(getAppUrl(storeHash, `/huntry/events/${event.id}`));
        });
      },
    },
    {
      content: "Delete",
      onItemClick: () => {
        setIsConfirmingDelete(true);
        setDropdownKey((key) => key + 1);
      },
    },
  ];

  return (
    <>
      <Dropdown
        key={dropdownKey}
        items={items}
        maxHeight={250}
        placement="bottom-end"
        toggle={<Button aria-label={`Actions for ${event.name}`} iconOnly={<MoreHorizIcon />} variant="subtle" />}
      />

      {isConfirmingDelete && (
        <Modal
          actions={[
            { text: "Cancel", variant: "subtle", onClick: closeModal },
            { text: "Delete", variant: "primary", actionType: "destructive", isLoading: isPending, onClick: handleConfirmDelete },
          ]}
          closeOnEscKey
          header="Delete Event"
          isOpen
          onClose={closeModal}
        >
          <Text marginBottom="none">
            Permanently delete &quot;{event.name}&quot;? This cannot be undone.
          </Text>
        </Modal>
      )}
    </>
  );
}
