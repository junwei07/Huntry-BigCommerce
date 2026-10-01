"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@bigcommerce/big-design";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { buildRewardsSearchParams } from "@/lib/huntry/rewards/query";
import { RewardsQuery } from "@/lib/huntry/rewards/types";

// Mirrors events'/sponsors' SortToggle — the one direction toggle
// RewardsQuery supports, sorting by name (alphabetical) rather than a date
// field.
export function SortToggle({ query }: { query: RewardsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const toggleDirection = () => {
    const nextQuery: RewardsQuery = { direction: query.direction === "ASC" ? "DESC" : "ASC" };
    const params = buildRewardsSearchParams(nextQuery);
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
