"use client";

import { usePathname, useRouter } from "next/navigation";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { FormSelect } from "@/components/ui/form-select";
import { buildSponsorsSearchParams, SPONSOR_SORT_OPTIONS } from "@/lib/huntry/sponsors/query";
import { SortDirection, SponsorsQuery } from "@/lib/huntry/sponsors/types";

// "Sort by" dropdown — selecting an option immediately re-navigates with the
// new ?direction= param. router.push is wrapped in useGlobalTransition (same as
// NewSponsorButton) so the full-page loading overlay covers the re-fetch.
export function SortSelect({ query }: { query: SponsorsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const handleChange = (direction: SortDirection) => {
    const queryString = buildSponsorsSearchParams({ direction }).toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <FormSelect
      disabled={isPending}
      label="Sort by"
      onOptionChange={handleChange}
      options={SPONSOR_SORT_OPTIONS}
      value={query.direction}
    />
  );
}
