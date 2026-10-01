import { Suspense } from "react";
import { EditSponsorView } from "@/components/huntry/sponsors/edit/edit-sponsor-view";
import { ContentFallback } from "@/components/layout/content-fallback";

export async function EditSponsorPage({
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
      {/* Content fallback because EditSponsorView must perform data fetching */}
      <EditSponsorView id={idNumber} storeHash={storeHashString} />
    </Suspense>
  );
}
