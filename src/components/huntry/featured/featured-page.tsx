import { Suspense } from "react";
import { FeaturedView } from "@/components/huntry/featured/featured-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function FeaturedPage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const storeHash = (await params).storeHash;
  const storeHashString = Array.isArray(storeHash) ? storeHash[0] : storeHash;

  return (
    <Suspense fallback={<ContentFallback />}>
      {/* Content fallback because FeaturedView must perform data fetching */}
      <FeaturedView storeHash={storeHashString} />
    </Suspense>
  );
}
