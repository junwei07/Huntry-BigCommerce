"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@bigcommerce/big-design";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { buildSponsorsSearchParams } from "@/lib/huntry/sponsors/query";
import { SponsorsQuery } from "@/lib/huntry/sponsors/types";

// Mirrors events' SortToggle — the one direction toggle SponsorsQuery
// supports, sorting by name (alphabetical) rather than a date field.
export function SortToggle({ query }: { query: SponsorsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const toggleDirection = () => {
    const nextQuery: SponsorsQuery = { direction: query.direction === "ASC" ? "DESC" : "ASC" };
    const params = buildSponsorsSearchParams(nextQuery);
    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <Button disabled={isPending} onClick={toggleDirection} variant="subtle">
      {query.direction === "ASC" ? "A–Z" : "Z–A"}
    </Button>
  );
}
