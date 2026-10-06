"use client";

import { usePathname, useRouter } from "next/navigation";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { FormSelect } from "@/components/ui/form-select";
import { buildRewardsSearchParams, REWARD_SORT_OPTIONS } from "@/lib/huntry/rewards/query";
import { RewardSort, RewardsQuery } from "@/lib/huntry/rewards/types";

// "Sort by" dropdown — selecting an option immediately re-navigates with the
// new ?sort= param, mirroring events' SortSelect.
export function SortSelect({ query }: { query: RewardsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const handleChange = (sort: RewardSort) => {
    const queryString = buildRewardsSearchParams({ sort }).toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <FormSelect
      disabled={isPending}
      label="Sort by"
      onOptionChange={handleChange}
      options={REWARD_SORT_OPTIONS}
      value={query.sort}
    />
  );
}
