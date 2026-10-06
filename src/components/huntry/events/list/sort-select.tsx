"use client";

import { usePathname, useRouter } from "next/navigation";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { FormSelect } from "@/components/ui/form-select";
import { buildEventsSearchParams, EVENT_SORT_OPTIONS } from "@/lib/huntry/events/query";
import { EventSort, EventsQuery } from "@/lib/huntry/events/types";

// "Sort by" dropdown — selecting an option immediately re-navigates with the
// new ?sort= param. router.push is wrapped in useGlobalTransition (same as
// NewEventButton) so the full-page loading overlay covers the re-fetch.
export function SortSelect({ query }: { query: EventsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const handleChange = (sort: EventSort) => {
    const queryString = buildEventsSearchParams({ sort }).toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <FormSelect
      disabled={isPending}
      label="Sort by"
      onOptionChange={handleChange}
      options={EVENT_SORT_OPTIONS}
      value={query.sort}
    />
  );
}
