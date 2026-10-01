import { Suspense } from "react";
import { EventListView } from "@/components/huntry/events/list/event-list-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const storeHash = resolvedParams.storeHash;
  const storeHashString = Array.isArray(storeHash) ? storeHash[0] : storeHash;

  return (
    <Suspense fallback={<ContentFallback />}>
      {/* Content fallback because EventListView must perform data fetching */}
      <EventListView searchParams={resolvedSearchParams} storeHash={storeHashString} />
    </Suspense>
  );
}
