import { Suspense } from "react";
import { EditRewardView } from "@/components/huntry/rewards/edit/edit-reward-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function EditRewardPage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await params;

  const id = resolvedParams.id;
  const idString = Array.isArray(id) ? id[0] : id;
  const idNumber = Number(idString);

  const storeHash = resolvedParams.storeHash;
  const storeHashString = Array.isArray(storeHash) ? storeHash[0] : storeHash;

  return (
    <Suspense fallback={<ContentFallback />}>
      {/* Content fallback because EditRewardView must perform data fetching */}
      <EditRewardView id={idNumber} storeHash={storeHashString} />
    </Suspense>
  );
}
