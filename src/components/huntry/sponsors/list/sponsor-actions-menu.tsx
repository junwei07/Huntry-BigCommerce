"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, DropdownItem, Modal, Text } from "@bigcommerce/big-design";
import { MoreHorizIcon } from "@bigcommerce/big-design-icons";
import { deleteHuntrySponsor } from "@/app/store/[storeHash]/huntry/sponsors/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { getAppUrl } from "@/lib/routing/app-url";

// Mirrors EventActionsMenu's exact Dropdown/kebab-Button/confirm-Modal
// shape (itself ported from GiftCertificateActionsMenu).
export function SponsorActionsMenu({ sponsor }: { sponsor: HuntrySponsor }) {
  const router = useRouter();
  const storeHash = useStoreHash();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Edit navigates to a route with its own not-yet-revealed Suspense
  // boundary, so it gets the same useGlobalTransition({ autoResolve: false
  // }) + EditSponsorForm's useClearGlobalLoading() pairing every "+ New X"
  // button already uses — see global-loading.tsx. Kept separate from the
  // plain isPending/startTransition above, which is Delete's own modal
  // spinner and shouldn't trigger the full-page overlay.
  const [, startEditTransition] = useGlobalTransition({ autoResolve: false });
  // Bumped on every selection to force Dropdown (downshift's useSelect
  // underneath) to remount with a fresh internal reducer — see
  // EventActionsMenu for why.
  const [dropdownKey, setDropdownKey] = useState(0);

  const closeModal = () => setIsConfirmingDelete(false);

  const handleConfirmDelete = () => {
    // Closed synchronously on click, not after the action resolves — see
    // EventActionsMenu's identical comment.
    closeModal();

    startTransition(async () => {
      await runServerAction(() => deleteHuntrySponsor(sponsor.id, storeHash));
    });
  };

  const items: DropdownItem[] = [
    {
      content: "Edit",
      onItemClick: () => {
        startEditTransition(() => {
          router.push(getAppUrl(storeHash, `/huntry/sponsors/${sponsor.id}`));
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
        toggle={<Button aria-label={`Actions for ${sponsor.name}`} iconOnly={<MoreHorizIcon />} variant="subtle" />}
      />

      {isConfirmingDelete && (
        <Modal
          actions={[
            { text: "Cancel", variant: "subtle", onClick: closeModal },
            { text: "Delete", variant: "primary", actionType: "destructive", isLoading: isPending, onClick: handleConfirmDelete },
          ]}
          closeOnEscKey
          header="Delete Sponsor"
          isOpen
          onClose={closeModal}
        >
          <Text marginBottom="none">
            Permanently delete &quot;{sponsor.name}&quot;? This cannot be undone.
          </Text>
        </Modal>
      )}
    </>
  );
}
