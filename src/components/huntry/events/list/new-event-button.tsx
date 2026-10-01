"use client";

import { useRouter } from "next/navigation";
import { Button } from "@bigcommerce/big-design";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { getAppUrl } from "@/lib/routing/app-url";

// A small client wrapper rather than an AppLink-styled Button: BigDesign's
// Button has no href/anchor-rendering prop (confirmed from its own type
// definition — it extends ComponentPropsWithoutRef<'button'> only), so
// navigation has to go through useRouter().
//
// router.push wrapped in useGlobalTransition so the full-page loading
// overlay gives real feedback while the destination route resolves —
// without it, a first-time dev-mode Turbopack compile of a not-yet-visited
// route can take several seconds with zero visual change, which reads as
// "the button doesn't work" (see HBC-CHANGELOG.md's BC-HUN-014 correction).
//
// autoResolve: false — /huntry/events/new's own <Suspense> boundary has
// never been revealed this session, so isPending resolves (and this button
// unmounts) as soon as its fallback commits, well before the real form
// does. NewEventForm calls useClearGlobalLoading() itself once it's actually
// showing, instead of relying on isPending here. SortToggle's own
// router.push navigation stays on the default (same page, no new boundary).
export function NewEventButton() {
  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useGlobalTransition({ autoResolve: false });

  const handleClick = () => {
    startTransition(() => {
      router.push(getAppUrl(storeHash, "/huntry/events/new"));
    });
  };

  return (
    <Button
      disabled={isPending}
      onClick={handleClick}
      style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
      variant="primary"
    >
      + New Event
    </Button>
  );
}
