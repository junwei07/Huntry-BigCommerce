import { Suspense } from "react";
import { SponsorListView } from "@/components/huntry/sponsors/list/sponsor-list-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function SponsorsPage({
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
      {/* Content fallback because SponsorListView must perform data fetching */}
      <SponsorListView searchParams={resolvedSearchParams} storeHash={storeHashString} />
    </Suspense>
  );
}
