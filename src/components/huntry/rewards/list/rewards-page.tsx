import { Suspense } from "react";
import { RewardListView } from "@/components/huntry/rewards/list/reward-list-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function RewardsPage({
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
      {/* Content fallback because RewardListView must perform data fetching */}
      <RewardListView searchParams={resolvedSearchParams} storeHash={storeHashString} />
    </Suspense>
  );
}
