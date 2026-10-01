"use client";

import { useRouter } from "next/navigation";
import { Button } from "@bigcommerce/big-design";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { getAppUrl } from "@/lib/routing/app-url";

// Mirrors NewEventButton: router.push wrapped in useGlobalTransition so the
// full-page loading overlay gives real feedback while a not-yet-visited
// route's first dev-mode compile resolves. autoResolve: false —
// NewSponsorForm calls useClearGlobalLoading() itself once it's actually
// showing, same reasoning as NewEventButton/NewEventForm.
export function NewSponsorButton() {
  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useGlobalTransition({ autoResolve: false });

  const handleClick = () => {
    startTransition(() => {
      router.push(getAppUrl(storeHash, "/huntry/sponsors/new"));
    });
  };

  return (
    <Button
      disabled={isPending}
      onClick={handleClick}
      style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
      variant="primary"
    >
      + New Sponsor
    </Button>
  );
}
