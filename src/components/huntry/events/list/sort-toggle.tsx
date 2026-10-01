"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@bigcommerce/big-design";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { buildEventsSearchParams } from "@/lib/huntry/events/query";
import { EventsQuery } from "@/lib/huntry/events/types";

// No draggable reordering (EVMS's own list_position drag-to-reorder has no
// backing column here — featured_order is BC-HUN-015's territory) — just
// the one direction toggle EventsQuery already supports (BC-HUN-013).
//
// router.push wrapped in useGlobalTransition, same as NewEventButton — gives
// full-page loading feedback while the re-sorted list re-fetches, rather
// than appearing unresponsive during a slow/cold request.
export function SortToggle({ query }: { query: EventsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const toggleDirection = () => {
    const nextQuery: EventsQuery = { direction: query.direction === "ASC" ? "DESC" : "ASC" };
    const params = buildEventsSearchParams(nextQuery);
    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <Button disabled={isPending} onClick={toggleDirection} variant="subtle">
      {query.direction === "ASC" ? "Soonest first" : "Latest first"}
    </Button>
  );
}
