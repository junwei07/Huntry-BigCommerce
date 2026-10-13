import { Suspense } from "react";
import { OverviewView } from "@/components/huntry/overview/overview-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function OverviewPage({
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
      {/* Content fallback because OverviewView must perform data fetching */}
      <OverviewView searchParams={resolvedSearchParams} storeHash={storeHashString} />
    </Suspense>
  );
}
