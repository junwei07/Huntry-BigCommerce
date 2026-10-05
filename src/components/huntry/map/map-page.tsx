import { Suspense } from "react";
import { MapView } from "@/components/huntry/map/map-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function MapPage({
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
      {/* Content fallback because MapView must perform data fetching */}
      <MapView searchParams={resolvedSearchParams} storeHash={storeHashString} />
    </Suspense>
  );
}
